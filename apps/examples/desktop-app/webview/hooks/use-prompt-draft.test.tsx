// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createDesktopAppState,
	type DesktopAppAction,
	desktopAppReducer,
} from "../lib/desktop-app-state";
import { PromptDraftCache, usePromptDraft } from "./use-prompt-draft";

let container: HTMLDivElement;
let root: Root;
let drafts: PromptDraftCache;
let current: ReturnType<typeof usePromptDraft>;
let renders: number;
let appState: ReturnType<typeof createDesktopAppState<"General">>;

function DraftPane({ threadId }: { threadId: string }) {
	current = usePromptDraft(drafts, threadId);
	renders += 1;
	return null;
}

async function navigate(action?: DesktopAppAction<"General">) {
	if (action) appState = desktopAppReducer(appState, action);
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

function pendingSend() {
	const pane = current;
	let resolve!: (accepted: boolean) => void;
	const response = new Promise<boolean>((done) => {
		resolve = done;
	});
	const restorePrompt = pane.clearPromptForSend();
	const finished = response.then((accepted) => {
		if (!accepted) restorePrompt("Submitted prompt");
	});
	return { resolve, finished };
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	drafts = new PromptDraftCache();
	renders = 0;
	appState = createDesktopAppState("new-session", "General", "local");
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("usePromptDraft", () => {
	it.each([
		false,
		true,
	])("restores cancelled cloud text and images after navigation (remounted: %s)", async (remounted) => {
		await navigate();
		const image = new File(["synthetic"], "draft.png", { type: "image/png" });
		const pane = current;
		let restore!: ReturnType<typeof current.clearDraftForHandoff>;
		act(() => {
			pane.setPromptInput("/cloud Continue");
			pane.setPendingAttachments([image]);
			restore = pane.clearDraftForHandoff("/cloud Continue");
		});
		await navigate({
			type: "navigate",
			destination: { ...appState.navigation.current, view: "sessions" },
		});
		if (remounted) await navigate({ type: "back" });
		act(() => {
			expect(restore()).toBe(true);
		});
		if (!remounted) await navigate({ type: "back" });
		expect(current.promptDraft.value).toBe("/cloud Continue");
		expect(current.pendingAttachments).toEqual([image]);
	});

	it.each([
		"erased text",
		"new image",
	])("preserves %s when cancelled cloud preparation belongs to an old pane", async (edit) => {
		await navigate();
		let restore!: ReturnType<typeof current.clearDraftForHandoff>;
		act(() => {
			restore = current.clearDraftForHandoff("/cloud Continue");
		});
		await openSession();
		await navigate({ type: "back" });
		const image = new File(["new"], "new.png", { type: "image/png" });
		act(() => {
			if (edit === "erased text") {
				current.handlePromptInputChange("Changed my mind");
				current.handlePromptInputChange("");
			} else {
				current.setPendingAttachments([image]);
			}
			expect(restore()).toBe(false);
		});
		expect(current.draftRef.current.text).toBe("");
		expect(current.pendingAttachments).toEqual(
			edit === "new image" ? [image] : [],
		);
	});

	it("restores an unchanged draft after a failed send, including the composer's clear acknowledgement", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
			current.handlePromptInputChange("");
		});
		await act(async () => {
			send.resolve(false);
			await send.finished;
		});
		expect(current.promptDraft.value).toBe("Submitted prompt");
		expect(drafts.get("new-session")?.text).toBe("Submitted prompt");
	});

	it("does not restore a failed send after the user types and erases newer text", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
			current.handlePromptInputChange("Changed my mind");
			current.handlePromptInputChange("");
		});
		await act(async () => {
			send.resolve(false);
			await send.finished;
		});
		expect(current.draftRef.current.text).toBe("");
		expect(drafts.get("new-session")?.text).toBe("");
	});

	it("invalidates recovery for an equal-valued external replacement", async () => {
		await navigate();
		let restore!: (value: string) => boolean;
		act(() => {
			restore = current.clearPromptForSend();
			current.setPromptInput("");
		});
		act(() => expect(restore("Old prompt")).toBe(false));
		expect(drafts.get("new-session")?.text).toBe("");
	});

	it("does not let an earlier send's failure replace a later send's draft", async () => {
		await navigate();
		let first!: ReturnType<typeof pendingSend>;
		let second!: ReturnType<typeof pendingSend>;
		act(() => {
			first = pendingSend();
			second = pendingSend();
		});
		await act(async () => {
			first.resolve(false);
			await first.finished;
		});
		expect(current.draftRef.current.text).toBe("");
		await act(async () => {
			second.resolve(false);
			await second.finished;
		});
		expect(current.draftRef.current.text).toBe("Submitted prompt");
	});

	it("does not let a retired pane's failed send overwrite a newer draft", async () => {
		await navigate();
		let send!: ReturnType<typeof pendingSend>;
		act(() => {
			send = pendingSend();
		});
		await openSession();
		await navigate({ type: "back" });
		act(() => current.handlePromptInputChange("Newer draft"));
		await act(async () => {
			send.resolve(false);
			await send.finished;
		});
		await openSession();
		await navigate({ type: "back" });
		expect(current.promptDraft.value).toBe("Newer draft");
	});

	it("does not recreate a deleted thread's draft after a late send failure", async () => {
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
		drafts.delete("new-session");
		await act(async () => {
			send.resolve(false);
			await send.finished;
		});
		expect(drafts.has("new-session")).toBe(false);
		expect(current.draftRef.current.text).toBe("");
	});

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
		expect(current.draftRef.current.text).toBe("");
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
		const draftRef = current.draftRef;
		await openSession();
		expect(current.draftRef).toBe(draftRef);
		expect(current.draftRef.current.text).toBe("Unsent follow-up");
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
		expect(current.draftRef.current.text).toBe(current.promptDraft.value);
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
		expect(drafts.get("new-session")?.text).toBe("");
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
		expect(drafts.get("new-session")?.text).toBe("");
	});

	it("keeps edited cloud text and images through a pane remount", async () => {
		await openSession();
		const image = new File(["synthetic"], "test.png", { type: "image/png" });
		act(() => {
			current.setPromptInput("Original follow-up");
			current.setPendingAttachments([image]);
			current.handlePromptInputChange("Edited follow-up");
		});
		await navigate({
			type: "navigate",
			destination: { ...appState.navigation.current, view: "sessions" },
		});
		await openSession();
		expect(current.draftRef.current.text).toBe("Edited follow-up");
		expect(current.pendingAttachments).toEqual([image]);
		act(() => {
			current.handlePromptInputChange("");
			current.setPendingAttachments([]);
		});
		await navigate({ type: "back" });
		await openSession();
		expect(current.draftRef.current.text).toBe("");
		expect(current.pendingAttachments).toEqual([]);
	});

	it("restores a rejected prompt and its files alongside attachments added during sending", async () => {
		await navigate();
		const original = new File(["a"], "a.png");
		const added = new File(["b"], "b.png");
		act(() => {
			current.setPromptInput("Submitted prompt");
			current.setPendingAttachments([original]);
		});
		const sent = current.pendingAttachments;
		const update = current.setPendingAttachments;
		let finish!: ReturnType<typeof current.clearPromptForSend>;
		act(() => {
			update([]);
			finish = current.clearPromptForSend();
		});
		act(() => current.setPendingAttachments([added]));
		act(() => {
			if (finish("Submitted prompt")) update((files) => [...files, ...sent]);
		});
		expect(current.promptDraft.value).toBe("Submitted prompt");
		expect(current.pendingAttachments).toEqual([added, original]);
		act(() => {
			update([]);
			update((files) => [...files, original]);
			update((files) => [...files, added]);
		});
		expect(current.pendingAttachments).toEqual([original, added]);
	});
});
