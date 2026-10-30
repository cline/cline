// @vitest-environment jsdom
import { Activity, act, type Dispatch, StrictMode, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/hooks/use-toast";
import {
	createDesktopAppState,
	type DesktopAppAction,
	type DesktopAppState,
	desktopAppReducer,
} from "@/lib/desktop-app-state";
import { requestPromptInputFocus } from "@/lib/prompt-input-focus";
import { PromptDraftCache, usePromptDraft } from "../use-prompt-draft";
import { useSideConversation } from "./use-side-conversation";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/prompt-input-focus", () => ({
	requestPromptInputFocus: vi.fn(),
}));
type Props = Parameters<typeof useSideConversation>[0];
let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof useSideConversation>;
let props: Props;
let editDraft: (value: string) => void;
function Harness() {
	current = useSideConversation(props);
	return null;
}
function DraftHarness() {
	const draft = usePromptDraft(props.drafts, props.threadId);
	editDraft = draft.handlePromptInputChange;
	current = useSideConversation({ ...props, setDraft: draft.setPromptInput });
	return null;
}
async function render(realDraft = false) {
	await act(async () =>
		root.render(
			<StrictMode>{realDraft ? <DraftHarness /> : <Harness />}</StrictMode>,
		),
	);
}
const result = {
	sessionId: "side",
	cwd: "/workspace",
	workspaceRoot: "/workspace",
	environmentId: "local",
	provider: "test",
	model: "test",
	mode: "act" as const,
	autoApproveTools: false,
	enableTools: true,
	metadata: {
		title: "Side: test",
		desktopSideConfig: {
			mode: "act" as const,
			autoApproveTools: false,
			enableTools: true,
		},
		desktopSideConversation: {
			version: 2 as const,
			parentSessionId: "parent",
			owner: { runId: "test-desktop-run", pid: 1, startToken: "test-start" },
		},
	},
};

let queuedState: DesktopAppState<"General">;
let queuedDispatch: Dispatch<DesktopAppAction<"General">>;
let restoredState: DesktopAppState<"General"> | undefined;
function QueuedHarness({ hydrated }: { hydrated: boolean | null }) {
	const [state, dispatch] = useReducer(
		desktopAppReducer<"General">,
		undefined,
		() =>
			restoredState ??
			createDesktopAppState("parent-thread", "General", "local"),
	);
	queuedState = state;
	queuedDispatch = dispatch;
	const child = state.threads.find(
		(thread) => thread.historySession?.sessionId === "side",
	);
	useSideConversation({
		...props,
		threadId: child?.id ?? "unopened",
		pendingSubmissions: child?.pendingSideSubmissions,
		hydrationSucceeded: hydrated,
		consumeSubmission: (threadId, submission) =>
			dispatch({
				type: "consume-initial-side-submission",
				threadId,
				submission,
			}),
	});
	return null;
}
async function renderQueued(hydrated: boolean | null) {
	await act(async () =>
		root.render(
			<StrictMode>
				<QueuedHarness hydrated={hydrated} />
			</StrictMode>,
		),
	);
}
function enqueue(question?: string) {
	queuedDispatch({
		type: "open-side",
		session: { ...result, status: "idle", startedAt: "2026-10-28T00:00:00Z" },
		submission: question ? { question } : undefined,
	});
}
beforeEach(async () => {
	vi.clearAllMocks();
	restoredState = undefined;
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	root = createRoot(container);
	props = {
		threadId: "thread",
		sessionId: "parent",
		isLocalMain: true,
		attachmentCount: 0,
		hydrationSucceeded: null,
		consumeSubmission: vi.fn(),
		create: vi.fn(async () => result),
		open: vi.fn(),
		send: vi.fn(async () => true),
		setDraft: vi.fn(),
		drafts: new PromptDraftCache(),
	};
	await render();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
describe("side conversation submission", () => {
	it.each([
		"/btw explain",
		"/side explain",
	])("intercepts %s without sending or queuing on the parent", async (command) => {
		await act(async () => {
			expect(await current.intercept(command)).toBe(true);
		});
		expect(props.create).toHaveBeenCalledTimes(1);
		expect(vi.mocked(props.create).mock.calls[0][0]).not.toBe(result.sessionId);
		expect(props.send).not.toHaveBeenCalled();
		expect(props.open).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "side",
				status: "idle",
				metadata: result.metadata,
			}),
			expect.objectContaining({ question: "explain" }),
		);
	});
	it.each([
		"resolve",
		"reject",
	])("leaves newer navigation and the saved draft alone when creation %ss after unmount", async (outcome) => {
		let resolveCreate: (value: typeof result) => void = () => {};
		let rejectCreate: (error: Error) => void = () => {};
		props.create = vi.fn(
			() =>
				new Promise<typeof result>((resolve, reject) => {
					resolveCreate = resolve;
					rejectCreate = reject;
				}),
		);
		await render(true);
		let pending: Promise<boolean> | undefined;
		await act(async () => {
			pending = current.intercept("/btw explain");
		});
		expect(props.drafts.get("thread")?.text).toBe("/btw explain");
		await act(async () => root.unmount());
		root = createRoot(container);
		await act(async () => {
			if (outcome === "resolve") resolveCreate(result);
			else rejectCreate(new Error("Connection lost"));
			await pending;
		});
		expect(props.open).not.toHaveBeenCalled();
		expect(props.send).not.toHaveBeenCalled();
		expect(requestPromptInputFocus).not.toHaveBeenCalled();
		expect(toast).not.toHaveBeenCalled();
		expect(props.drafts.get("thread")?.text).toBe("/btw explain");
	});

	it("clears the real parent draft and opens the side while the pane still owns creation", async () => {
		await render(true);
		await act(async () => {
			await current.intercept("/btw explain");
		});
		expect(props.drafts.get("thread")?.text).toBe("");
		expect(props.open).toHaveBeenCalledTimes(1);
		expect(requestPromptInputFocus).not.toHaveBeenCalled();
	});

	it("retains accepted creation while a Hub reconnect hides the pane", async () => {
		let resolveCreate: (value: typeof result) => void = () => {};
		props.create = vi.fn(
			() =>
				new Promise<typeof result>((resolve) => {
					resolveCreate = resolve;
				}),
		);
		const renderActivity = async (mode: "visible" | "hidden") => {
			await act(async () =>
				root.render(
					<StrictMode>
						<Activity mode={mode}>
							<DraftHarness />
						</Activity>
					</StrictMode>,
				),
			);
		};
		await renderActivity("visible");
		let pending: Promise<boolean> | undefined;
		await act(async () => {
			pending = current.intercept("/btw explain");
		});
		await renderActivity("hidden");
		await act(async () => {
			resolveCreate(result);
			await pending;
		});
		await renderActivity("visible");
		expect(current.openingState.kind).toBe("idle");
		expect(props.open).toHaveBeenCalledTimes(1);
	});

	it("reuses the selected side for repeated questions without replacing its draft", async () => {
		props.existingSession = {
			...result,
			status: "idle",
			startedAt: "2026-10-28T00:00:00Z",
		};
		props.drafts.set("side-thread", {
			text: "Unsent side draft",
			attachments: [],
		});
		await render();
		await act(async () => {
			await current.intercept("/btw another question");
		});
		expect(props.create).not.toHaveBeenCalled();
		expect(props.open).toHaveBeenCalledWith(
			props.existingSession,
			expect.objectContaining({ question: "another question" }),
		);
		expect(props.drafts.get("side-thread")?.text).toBe("Unsent side draft");
	});
	it("reopening reuses the current side while preserving the parent's draft", async () => {
		props.existingSession = {
			...result,
			status: "idle",
			startedAt: "2026-10-28T00:00:00Z",
		};
		props.drafts.set("thread", { text: "Keep this draft", attachments: [] });
		await render(true);
		await act(async () => {
			await current.openSide();
		});
		expect(props.create).not.toHaveBeenCalled();
		expect(props.open).toHaveBeenCalledWith(props.existingSession, undefined);
		expect(props.drafts.get("thread")?.text).toBe("Keep this draft");
	});
	it("dispatches later routed questions once each through the same side controller", async () => {
		props.hydrationSucceeded = true;
		props.pendingSubmissions = [{ question: "first" }];
		await render();
		props.pendingSubmissions = [{ question: "second" }];
		await render();
		await render();
		expect(props.send).toHaveBeenCalledTimes(2);
		expect(props.send).toHaveBeenLastCalledWith("second");
	});

	it("does not clear newer parent typing when opening finishes", async () => {
		let resolveCreate: (value: typeof result) => void = () => {};
		props.create = vi.fn(
			() =>
				new Promise<typeof result>((resolve) => {
					resolveCreate = resolve;
				}),
		);
		await render(true);
		let pending: Promise<boolean> | undefined;
		await act(async () => {
			pending = current.intercept("/btw explain");
		});
		await act(async () => editDraft("New parent draft"));
		await act(async () => {
			resolveCreate(result);
			await pending;
		});
		expect(props.drafts.get("thread")?.text).toBe("New parent draft");
		expect(props.open).toHaveBeenCalledTimes(1);
	});

	it("keeps an accepted creation hidden when the rail was closed during opening", async () => {
		let revision = 0;
		props.getCloseRevision = () => revision;
		let resolveCreate: (value: typeof result) => void = () => {};
		props.create = vi.fn(
			() =>
				new Promise<typeof result>((resolve) => {
					resolveCreate = resolve;
				}),
		);
		await render();
		let pending: Promise<boolean> | undefined;
		await act(async () => {
			pending = current.intercept("/btw explain");
		});
		revision++;
		await act(async () => {
			resolveCreate(result);
			await pending;
		});
		expect(props.open).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: "side" }),
			{ question: "explain" },
			false,
		);
	});

	it("opens a bare command without scheduling a question", async () => {
		await act(async () => {
			await current.intercept("/btw");
		});
		expect(props.open).toHaveBeenCalledWith(expect.anything(), undefined);
	});
	it.each([
		{ attachmentCount: 1 },
		{ isLocalMain: false },
		{ sessionId: null },
	])("preserves unsupported drafts and attachments: %o", async (override) => {
		props = { ...props, ...override };
		await render();
		await act(async () => {
			await current.intercept("/side question");
		});
		expect(props.setDraft).toHaveBeenCalledWith("/side question");
		expect(props.create).not.toHaveBeenCalled();
		expect(props.send).not.toHaveBeenCalled();
	});
	it("consumes before one send after hydration, including StrictMode and remount", async () => {
		props.pendingSubmissions = [{ question: "why?" }];
		await render();
		expect(props.send).not.toHaveBeenCalled();
		props.send = vi.fn(async () => {
			expect(props.consumeSubmission).toHaveBeenCalledWith(
				"thread",
				props.pendingSubmissions?.[0],
			);
			return true;
		});
		props.hydrationSucceeded = true;
		await render();
		await render();
		expect(props.send).toHaveBeenCalledTimes(1);
		expect(props.send).toHaveBeenCalledWith("why?");
		expect(props.drafts.has("thread")).toBe(false);
		props.pendingSubmissions = undefined;
		await act(async () => root.unmount());
		root = createRoot(container);
		await render();
		expect(props.send).toHaveBeenCalledTimes(1);
	});
	it("keeps a question as a side draft when attach fails, without sending", async () => {
		props.pendingSubmissions = [{ question: "why?" }];
		props.hydrationSucceeded = false;
		const attachment = new File(["draft"], "draft.txt");
		props.drafts.set("thread", { text: "", attachments: [attachment] });
		await render();
		expect(props.send).not.toHaveBeenCalled();
		expect(props.setDraft).toHaveBeenCalledWith("why?");
		expect(props.drafts.get("thread")).toEqual({
			text: "why?",
			attachments: [attachment],
		});
		expect(props.consumeSubmission).toHaveBeenCalledTimes(1);
	});
	it("does not show a dispatched question as a draft while the turn is pending", async () => {
		props.pendingSubmissions = [{ question: "why?" }];
		props.hydrationSucceeded = true;
		let rejectSend: (error: Error) => void = () => {};
		props.send = vi.fn(
			() =>
				new Promise<boolean>((_resolve, reject) => {
					rejectSend = reject;
				}),
		);
		await render();
		expect(props.drafts.has("thread")).toBe(false);
		await act(async () => root.unmount());
		root = createRoot(container);
		await act(async () => rejectSend(new Error("Not sent")));
		expect(props.drafts.get("thread")?.text).toBe("why?");
	});

	it("restores rejected first sends without recreating a side", async () => {
		props.pendingSubmissions = [{ question: "why?" }];
		props.hydrationSucceeded = true;
		props.send = vi.fn(async () => false);
		await render();
		expect(props.setDraft).toHaveBeenCalledWith("why?");
		expect(props.create).not.toHaveBeenCalled();
	});
});

describe("pending side submissions with the actual app reducer", () => {
	it("keeps all questions through delayed hydration, bare reopen, and an active first send", async () => {
		let finishFirst: (taken: boolean) => void = () => {};
		props.send = vi.fn((question: string) =>
			question === "first"
				? new Promise<boolean>((resolve) => {
						finishFirst = resolve;
					})
				: Promise.resolve(true),
		);
		await renderQueued(null);
		await act(async () => {
			enqueue("first");
			enqueue("second");
			enqueue();
		});
		expect(props.send).not.toHaveBeenCalled();
		expect(
			queuedState.threads[1].pendingSideSubmissions?.map(
				(item) => item.question,
			),
		).toEqual(["first", "second"]);
		await renderQueued(true);
		expect(props.send).toHaveBeenCalledTimes(2);
		expect(
			queuedState.threads[1].pendingSideSubmissions?.map(
				(item) => item.question,
			),
		).toEqual([]);
		await act(async () => {
			enqueue("third");
			enqueue();
		});
		expect(props.send).toHaveBeenCalledTimes(3);
		await act(async () => finishFirst(true));
		expect(
			vi.mocked(props.send).mock.calls.map(([question]) => question),
		).toEqual(["first", "second", "third"]);
		expect(queuedState.threads[1].pendingSideSubmissions).toEqual([]);
		restoredState = queuedState;
		await act(async () => root.unmount());
		root = createRoot(container);
		await renderQueued(true);
		expect(props.send).toHaveBeenCalledTimes(3);
	});
	it("restores every pending question in order after hydration fails without replacing an existing draft", async () => {
		await renderQueued(null);
		await act(async () => {
			enqueue("first");
			enqueue("second");
			enqueue();
		});
		const childId = queuedState.threads[1].id;
		props.drafts.set(childId, { text: "Unsent draft", attachments: [] });
		await renderQueued(false);
		expect(props.send).not.toHaveBeenCalled();
		expect(props.drafts.get(childId)?.text).toBe(
			"Unsent draft\n\nfirst\n\nsecond",
		);
		expect(queuedState.threads[1].pendingSideSubmissions).toEqual([]);
		await renderQueued(true);
		expect(props.send).not.toHaveBeenCalled();
	});
});

describe("side pane opening", () => {
	it("reveals before creation settles, shares pending work and ignores parent attachments for toolbar open", async () => {
		let finishCreate: (value: typeof result) => void = () => {};
		props.attachmentCount = 1;
		props.reveal = vi.fn();
		props.create = vi.fn(
			() =>
				new Promise<typeof result>((resolve) => {
					finishCreate = resolve;
				}),
		);
		await render(true);
		let pending: Promise<void> | undefined;
		await act(async () => {
			pending = current.openSide();
		});
		expect(props.reveal).toHaveBeenCalledOnce();
		expect(current.openingState.kind).toBe("opening");
		await act(async () => {
			await current.openSide();
		});
		expect(props.create).toHaveBeenCalledOnce();
		await act(async () => {
			finishCreate(result);
			await pending;
		});
		expect(props.send).not.toHaveBeenCalled();
		expect(current.openingState.kind).toBe("idle");
	});

	it("retries an uncertain toolbar creation with the original identity and no model request", async () => {
		props.create = vi
			.fn()
			.mockRejectedValueOnce(new Error("Timed out"))
			.mockResolvedValue(result);
		await render();
		await act(async () => {
			await current.openSide();
		});
		expect(current.openingState.kind).toBe("error");
		await act(async () => {
			await current.retry();
		});
		expect(vi.mocked(props.create).mock.calls[1][0]).toBe(
			vi.mocked(props.create).mock.calls[0][0],
		);
		expect(props.send).not.toHaveBeenCalled();
		expect(props.open).toHaveBeenCalledWith(expect.anything(), undefined);
	});
});

it("inline retry submits the original question without replacing newer parent typing", async () => {
	props.create = vi
		.fn()
		.mockRejectedValueOnce(new Error("Timed out"))
		.mockResolvedValue(result);
	await render(true);
	await act(async () => {
		await current.intercept("/btw original question");
	});
	expect(current.openingState).toEqual({ kind: "error", message: "Timed out" });
	await act(async () => editDraft("New main draft"));
	await act(async () => {
		await current.retry();
	});
	expect(props.create).toHaveBeenCalledTimes(2);
	expect(vi.mocked(props.create).mock.calls[1][0]).toBe(
		vi.mocked(props.create).mock.calls[0][0],
	);
	expect(current.openingState.kind).toBe("idle");
	expect(props.send).not.toHaveBeenCalled();
	expect(props.drafts.get("thread")?.text).toBe("New main draft");
	expect(props.open).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
		question: "original question",
	});
});
