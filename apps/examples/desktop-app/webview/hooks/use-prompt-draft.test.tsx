// @vitest-environment jsdom

import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createDesktopAppState,
	type DesktopAppAction,
	desktopAppReducer,
} from "../lib/desktop-app-state";
import { PromptDraftStore } from "../lib/prompt-draft-store";
import { usePromptDraft } from "./use-prompt-draft";

type DesktopAction = DesktopAppAction<"General">;

let container: HTMLDivElement;
let root: Root;
let drafts: PromptDraftStore;
let current: ReturnType<typeof usePromptDraft>;
let renders: number;
let mounts: number;
let appState: ReturnType<typeof createDesktopAppState<"General">>;

function DraftPane({ threadId }: { threadId: string }) {
	current = usePromptDraft(drafts, threadId);
	renders += 1;
	useEffect(() => {
		mounts += 1;
	}, []);
	return null;
}

async function navigate(action?: DesktopAction) {
	if (action) appState = desktopAppReducer(appState, action);
	// The app prunes after every thread-list change.
	drafts.prune(new Set(appState.threads.map((thread) => thread.id)));
	const { activeThreadId, view } = appState.navigation.current;
	await act(async () => {
		root.render(
			<StrictMode>
				{view !== "sessions" && (
					<DraftPane key={activeThreadId} threadId={activeThreadId} />
				)}
			</StrictMode>,
		);
	});
}

async function openSession(environmentId = "local") {
	await navigate({
		type: "open-session",
		environmentId,
		session: {
			sessionId: "existing-session",
			environmentId,
			status: "completed",
			provider: "cline",
			model: "test-model",
			cwd: "/workspace",
			workspaceRoot: "/workspace",
			startedAt: "2026-09-29T00:00:00.000Z",
		},
	});
}

function pendingSend(attachments: File[] = []) {
	const attempt = current.beginSend("Submitted prompt", attachments);
	let resolve!: (accepted: boolean) => void;
	const response = new Promise<boolean>((done) => {
		resolve = done;
	});
	let restored = false;
	const finished = response.then((accepted) => {
		restored = attempt.settle(accepted);
	});
	return { resolve, finished, restored: () => restored };
}

async function settle(send: ReturnType<typeof pendingSend>, accepted: boolean) {
	await act(async () => {
		send.resolve(accepted);
		await send.finished;
	});
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	drafts = new PromptDraftStore();
	renders = 0;
	mounts = 0;
	appState = createDesktopAppState("new-session", "General", "local");
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("usePromptDraft failed-send recovery", () => {
	it("restores an unchanged draft, including the composer's clear acknowledgement", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
			current.handlePromptInputChange("");
		});
		await settle(send, false);
		expect(send.restored()).toBe(true);
		expect(current.promptDraft.value).toBe("Submitted prompt");
		expect(drafts.getDraft("new-session")).toBe("Submitted prompt");
	});

	it("restores a failure that happens while the user is on another thread", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
		});
		await openSession();
		await settle(send, false);
		expect(send.restored()).toBe(true);
		await navigate({ type: "back" });
		expect(current.promptDraft.value).toBe("Submitted prompt");
		await openSession();
		await navigate({ type: "back" });
		expect(current.promptDraft.value).toBe("Submitted prompt");
	});

	it("shows the restored draft immediately when the user already returned", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
		});
		await openSession();
		await navigate({ type: "back" });
		expect(current.promptDraft.value).toBe("");
		await settle(send, false);
		expect(current.promptDraft.value).toBe("Submitted prompt");
	});

	it("does not let a failed send overwrite newer text", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
		});
		await openSession();
		await navigate({ type: "back" });
		act(() => current.handlePromptInputChange("Newer draft"));
		await settle(send, false);
		expect(send.restored()).toBe(false);
		await openSession();
		await navigate({ type: "back" });
		expect(current.promptDraft.value).toBe("Newer draft");
	});

	it("does not restore after the user types and erases newer text", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
			current.handlePromptInputChange("Changed my mind");
			current.handlePromptInputChange("");
		});
		await settle(send, false);
		expect(send.restored()).toBe(false);
		expect(drafts.getDraft("new-session")).toBe("");
	});

	it("invalidates recovery for an equal-valued external replacement", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
			current.setPromptInput("");
		});
		await settle(send, false);
		expect(send.restored()).toBe(false);
		expect(drafts.getDraft("new-session")).toBe("");
	});

	it("never brings back an accepted prompt", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
		});
		await openSession();
		await settle(send, true);
		await navigate({ type: "back" });
		expect(send.restored()).toBe(false);
		expect(current.promptDraft.value).toBe("");
		expect(drafts.getDraft("new-session")).toBe("");
	});

	it("does not recreate a deleted thread's draft after a late failure", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
		});
		await navigate({
			type: "delete-session",
			deletedSessionId: "pending-session",
			deletedThreadId: "new-session",
			fallbackThreadId: "replacement",
			fallbackEnvironmentId: "local",
		});
		await settle(send, false);
		expect(send.restored()).toBe(false);
		expect(drafts.getDraft("new-session")).toBe("");
	});

	it("ignores a stale attempt after its thread ID is reused", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
		});
		drafts.prune(new Set());
		drafts.edit("new-session", "Fresh thread draft");
		await settle(send, false);
		expect(send.restored()).toBe(false);
		expect(drafts.getDraft("new-session")).toBe("Fresh thread draft");
	});

	it("does not let an earlier send's failure replace a later send", async () => {
		await navigate();
		let first!: ReturnType<typeof pendingSend>;
		let second!: ReturnType<typeof pendingSend>;
		act(() => {
			first = pendingSend();
			second = pendingSend();
		});
		await settle(first, false);
		expect(first.restored()).toBe(false);
		expect(drafts.getDraft("new-session")).toBe("");
		await settle(second, false);
		expect(second.restored()).toBe(true);
		expect(drafts.getDraft("new-session")).toBe("Submitted prompt");
	});

	it("settles each attempt only once", async () => {
		await navigate();
		const attempt = current.beginSend("Once", []);
		expect(attempt.settle(false)).toBe(true);
		expect(attempt.settle(false)).toBe(false);
	});
});

describe("PromptDraftStore attachment recovery", () => {
	const file = (name: string) => new File([name], name);

	it("delivers a failed send's attachments to a mounted listener", async () => {
		await navigate();
		const received: File[][] = [];
		const unsubscribe = drafts.subscribeAttachments("new-session", (files) =>
			received.push(files),
		);
		const attachment = file("a.png");
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend([attachment]);
		});
		await settle(send, false);
		unsubscribe();
		expect(received).toEqual([[attachment]]);
	});

	it("holds attachments for a pane that mounts after the failure", async () => {
		await navigate();
		const attachment = file("b.png");
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend([attachment]);
		});
		await openSession();
		await settle(send, false);
		const received: File[][] = [];
		const first = drafts.subscribeAttachments("new-session", (files) =>
			received.push(files),
		);
		first();
		const second = drafts.subscribeAttachments("new-session", (files) =>
			received.push(files),
		);
		second();
		expect(received).toEqual([[attachment]]);
	});

	it("discards attachments for accepted, superseded, and deleted sends", async () => {
		await navigate();
		const received: File[][] = [];
		drafts.subscribeAttachments("new-session", (files) => received.push(files));
		const sends: ReturnType<typeof pendingSend>[] = [];
		act(() => {
			sends.push(pendingSend([file("accepted.png")]));
		});
		await settle(sends[0], true);
		act(() => {
			sends.push(pendingSend([file("superseded.png")]));
			current.handlePromptInputChange("typed since");
		});
		await settle(sends[1], false);
		act(() => {
			current.handlePromptInputChange("");
			sends.push(pendingSend([file("deleted.png")]));
		});
		drafts.prune(new Set());
		await settle(sends[2], false);
		const late = drafts.subscribeAttachments("new-session", (files) =>
			received.push(files),
		);
		late();
		expect(received).toEqual([]);
	});
});

describe("usePromptDraft navigation", () => {
	it("preserves a newly started session's follow-up when reopened through history", async () => {
		await navigate();
		await navigate({
			type: "thread-started",
			threadId: "new-session",
			sessionId: "existing-session",
		});
		act(() => current.handlePromptInputChange("Follow-up to my new session"));
		// The same session ID on a different host must not reuse the local thread.
		await openSession("remote");
		expect(current.promptDraft.value).toBe("");
		act(() => current.handlePromptInputChange("Remote follow-up"));
		await openSession("local");
		expect(appState.navigation.current.activeThreadId).toBe("new-session");
		expect(current.promptDraft.value).toBe("Follow-up to my new session");
		await openSession("remote");
		expect(current.promptDraft.value).toBe("Remote follow-up");
	});

	it("keeps the same pane and draft when clicking its own newly started session", async () => {
		await navigate();
		await navigate({
			type: "thread-started",
			threadId: "new-session",
			sessionId: "existing-session",
		});
		act(() => current.handlePromptInputChange("Unsent follow-up"));
		const mountedPanes = mounts;
		await openSession();
		expect(mounts).toBe(mountedPanes);
		expect(drafts.getDraft("new-session")).toBe("Unsent follow-up");
		expect(appState.threads).toHaveLength(1);
	});

	it("restores a new session draft after switching to a session and back", async () => {
		await navigate();
		const renderCount = renders;
		act(() =>
			current.handlePromptInputChange("Unsent prompt\nwith more detail"),
		);
		expect(renders).toBe(renderCount);

		await openSession();
		expect(current.promptDraft.value).toBe("");
		act(() => current.handlePromptInputChange("Follow-up draft"));

		await navigate({ type: "back" });
		expect(current.promptDraft.value).toBe("Unsent prompt\nwith more detail");
		await navigate({ type: "forward" });
		expect(current.promptDraft.value).toBe("Follow-up draft");
	});

	it("returns to the unfinished draft via New without leaking it into a fresh thread", async () => {
		await navigate();
		act(() => current.handlePromptInputChange("Keep this draft"));
		await openSession();
		await navigate({
			type: "select-environment-draft",
			environmentId: "local",
			threadId: "unused-fallback",
		});
		expect(appState.navigation.current.activeThreadId).toBe("new-session");
		expect(current.promptDraft.value).toBe("Keep this draft");

		await navigate({
			type: "new-thread",
			threadId: "fresh-session",
			environmentId: "local",
		});
		expect(current.promptDraft.value).toBe("");
	});

	it("preserves drafts when the sessions view unmounts the pane", async () => {
		await navigate();
		act(() => current.handlePromptInputChange("Still writing"));
		await navigate({
			type: "navigate",
			destination: { ...appState.navigation.current, view: "sessions" },
		});
		await navigate({ type: "back" });
		expect(current.promptDraft.value).toBe("Still writing");
	});

	it("keeps drafts for the same session ID separate across environments", async () => {
		await openSession("local");
		act(() => current.handlePromptInputChange("Local draft"));
		await openSession("remote");
		expect(current.promptDraft.value).toBe("");
		act(() => current.handlePromptInputChange("Remote draft"));
		await openSession("local");
		expect(current.promptDraft.value).toBe("Local draft");
		await openSession("remote");
		expect(current.promptDraft.value).toBe("Remote draft");
	});

	it("persists externally injected prompts and clears submitted drafts", async () => {
		await navigate();
		act(() => current.setPromptInput("Edited fork prompt"));
		await openSession();
		await navigate({ type: "back" });
		expect(current.promptDraft.value).toBe("Edited fork prompt");
		act(() => current.setPromptInput(""));
		expect(drafts.getDraft("new-session")).toBe("");
		await openSession();
		await navigate({ type: "back" });
		expect(current.promptDraft.value).toBe("");
	});

	it("does not resurrect a manually erased draft", async () => {
		await navigate();
		act(() => current.handlePromptInputChange("Erase me"));
		act(() => current.handlePromptInputChange(""));
		await openSession();
		await navigate({ type: "back" });
		expect(current.promptDraft.value).toBe("");
		expect(drafts.getDraft("new-session")).toBe("");
	});
});
