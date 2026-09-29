// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createDesktopAppState,
	type DesktopAppAction,
	desktopAppReducer,
} from "../lib/desktop-app-state";
import { usePromptDraft } from "./use-prompt-draft";

let container: HTMLDivElement;
let root: Root;
let drafts: Map<string, string>;
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

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	drafts = new Map();
	renders = 0;
	appState = createDesktopAppState("new-session", "General", "local");
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("usePromptDraft", () => {
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
		expect(current.promptInputRef.current).toBe(current.promptDraft.value);
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
		expect(drafts.has("new-session")).toBe(false);
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
		expect(drafts.has("new-session")).toBe(false);
	});
});
