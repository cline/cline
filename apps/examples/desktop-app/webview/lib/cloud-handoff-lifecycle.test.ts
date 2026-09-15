import { describe, expect, it, vi } from "vitest";
import type { HandoffResult } from "./cloud-handoff";
import {
	createHandoffLifecycle,
	type HandoffLifecycleToast,
	type HandoffProgressEventPayload,
} from "./cloud-handoff-lifecycle";
import {
	type CloudHandoffUiAction,
	type CloudHandoffUiState,
	cloudHandoffUiReducer,
} from "./cloud-handoff-ui-state";

const SOURCE = "local-1";
const TARGET = "cloud-1";
const DASHBOARD_URL = "https://app.cline.bot/agents/cloud-1";

function makeAttachment(name = "shot.png"): File {
	return new File(["img"], name, { type: "image/png" });
}

function makeResult(overrides: Partial<HandoffResult> = {}): HandoffResult {
	return {
		outerSessionId: TARGET,
		innerSessionId: "inner-1",
		dashboardUrl: DASHBOARD_URL,
		destination: "in_app",
		...overrides,
	};
}

function completeEvent(
	overrides: Partial<HandoffProgressEventPayload> = {},
): HandoffProgressEventPayload {
	return {
		sourceSessionId: SOURCE,
		phase: "complete",
		sessionId: TARGET,
		dashboardUrl: DASHBOARD_URL,
		destination: "in_app",
		...overrides,
	};
}

/** Mock effects; dispatch feeds the REAL reducer so tests can assert the
 * final UI entries each ordering produces. */
function makeHarness(options: { openSessionResult?: boolean } = {}) {
	let state: CloudHandoffUiState = {};
	const dispatched: CloudHandoffUiAction[] = [];
	const dispatch = vi.fn((action: CloudHandoffUiAction) => {
		dispatched.push(action);
		state = cloudHandoffUiReducer(state, action);
	});
	const toast = vi.fn((_t: HandoffLifecycleToast) => {});
	const openSession = vi.fn(
		(
			_sessionId: string,
			_opts: {
				silent: true;
				initialPromptDraft?: string;
				initialAttachments?: File[];
				expectedActiveThreadId?: string;
			},
		) => Promise.resolve(options.openSessionResult ?? true),
	);
	const openExternal = vi.fn((_url: string) => Promise.resolve());
	const lifecycle = createHandoffLifecycle({
		dispatch,
		toast,
		openSession,
		openExternal,
	});
	return {
		lifecycle,
		dispatch,
		dispatched,
		toast,
		openSession,
		openExternal,
		getState: () => state,
	};
}

function warningToastCount(toastMock: {
	mock: { calls: [HandoffLifecycleToast][] };
}): number {
	return toastMock.mock.calls.filter(
		([t]) => t.title === "Handoff completed with a warning",
	).length;
}

describe("cloud handoff lifecycle: RPC resolved", () => {
	it("(a) no warning: complete dispatch, in-app open, no toast at all", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult(),
			nextCommand: "",
			sourceAttachments: [],
			isThreadActive: () => true,
		});
		expect(h.dispatched).toEqual([
			{
				type: "complete",
				sourceSessionId: SOURCE,
				receipt: { targetSessionId: TARGET, dashboardUrl: DASHBOARD_URL },
				externalPresentation: false,
				pendingPrompt: undefined,
			},
		]);
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
		});
		expect(h.toast).not.toHaveBeenCalled();
		expect(h.openExternal).not.toHaveBeenCalled();
		expect(h.getState()[SOURCE]).toMatchObject({ status: "complete" });
	});

	it("accepts the legacy sessionId alias when outerSessionId is empty", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult({ outerSessionId: "", sessionId: TARGET }),
			nextCommand: "",
			sourceAttachments: [],
		});
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
		});
	});

	it("throws when the result carries no cloud session, so the caller's catch routes it to onRpcRejected", async () => {
		const h = makeHarness();
		await expect(
			h.lifecycle.onRpcResolved(SOURCE, {
				result: makeResult({ outerSessionId: "", dashboardUrl: "" }),
				nextCommand: "",
				sourceAttachments: [],
			}),
		).rejects.toThrow("Cloud handoff did not return a cloud session.");
		expect(h.dispatch).not.toHaveBeenCalled();
		expect(h.toast).not.toHaveBeenCalled();
	});

	it("(b) unqueued warning: prompt_reconciled + open with draft and attachments + single warning toast quoting the command", async () => {
		const h = makeHarness();
		const attachment = makeAttachment();
		const pendingPrompt = {
			content: "fix the tests",
			submittedAt: 1,
			baselineOccurrences: 0,
		};
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult({
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
			}),
			nextCommand: "fix the tests",
			sourceAttachments: [attachment],
			pendingPrompt,
			isThreadActive: () => true,
		});
		expect(h.dispatched).toEqual([
			{
				type: "complete",
				sourceSessionId: SOURCE,
				receipt: { targetSessionId: TARGET, dashboardUrl: DASHBOARD_URL },
				externalPresentation: false,
				pendingPrompt,
				warningKind: "unqueued",
				retryDraft: "fix the tests",
				retryAttachments: [attachment],
			},
			{ type: "prompt_reconciled", sourceSessionId: TARGET },
			{ type: "retry_delivered", sourceSessionId: SOURCE },
		]);
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
			initialPromptDraft: "fix the tests",
			initialAttachments: [attachment],
		});
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Handoff completed with a warning",
			description:
				'The follow-up command could not be queued. Your command was kept: "fix the tests" — send it from the cloud session.',
		});
		// The optimistic bubble is cleared: the target_prompt entry seeded by
		// the complete dispatch is removed by prompt_reconciled.
		expect(h.getState()[TARGET]).toBeUndefined();
	});

	it("(c) unconfirmed warning: destructive toast, NO prefill", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult({
				warning: "Cline could not confirm the follow-up was queued.",
				warningKind: "unconfirmed",
			}),
			nextCommand: "deploy it",
			sourceAttachments: [makeAttachment()],
			isThreadActive: () => true,
		});
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
		});
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Handoff completed with a warning",
			description: "Cline could not confirm the follow-up was queued.",
			variant: "destructive",
		});
	});

	it("falls back to the browser when the in-app open fails", async () => {
		const h = makeHarness({ openSessionResult: false });
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult(),
			nextCommand: "",
			sourceAttachments: [],
			isThreadActive: () => true,
		});
		expect(h.dispatched).toEqual([
			expect.objectContaining({ type: "complete" }),
			{ type: "external", sourceSessionId: SOURCE },
		]);
		expect(h.openExternal).toHaveBeenCalledExactlyOnceWith(DASHBOARD_URL);
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Opened handoff in your browser",
			description: "The cloud session could not be attached inside Cline.",
		});
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			externalPresentation: true,
		});
	});

	it("shows the destructive fallback toast when the browser cannot open either", async () => {
		const h = makeHarness({ openSessionResult: false });
		h.openExternal.mockRejectedValueOnce(new Error("no browser"));
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult(),
			nextCommand: "",
			sourceAttachments: [],
			isThreadActive: () => true,
		});
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Unable to open the browser",
			description: "Use the recovery link to open the cloud session manually.",
			variant: "destructive",
		});
	});

	it("external destination: opens the browser, no in-app open, no toast on success", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult({ destination: "external" }),
			nextCommand: "",
			sourceAttachments: [],
			isThreadActive: () => true,
		});
		expect(h.openSession).not.toHaveBeenCalled();
		expect(h.openExternal).toHaveBeenCalledExactlyOnceWith(DASHBOARD_URL);
		expect(h.toast).not.toHaveBeenCalled();
	});

	it("external destination: browser failure downgrades to the recovery-link toast", async () => {
		const h = makeHarness();
		h.openExternal.mockRejectedValueOnce(new Error("no browser"));
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult({ destination: "external" }),
			nextCommand: "",
			sourceAttachments: [],
		});
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Cloud handoff complete",
			description: "Use the recovery link to open the cloud session.",
		});
	});

	it("inactive source thread: no in-app open, session-list toast instead", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult(),
			nextCommand: "",
			sourceAttachments: [],
			isThreadActive: () => false,
		});
		expect(h.openSession).not.toHaveBeenCalled();
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Cloud handoff complete",
			description: "The cloud session is ready in your session list.",
		});
	});

	it("assumes the thread is active when the caller provides no probe", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult(),
			nextCommand: "",
			sourceAttachments: [],
		});
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
		});
	});
});

describe("cloud handoff lifecycle: event/RPC ordering races", () => {
	it("event before a successful RPC leaves the full in-app open to the attachment-bearing RPC result", async () => {
		const h = makeHarness();
		const attachment = makeAttachment();
		await h.lifecycle.onEvent(
			completeEvent({
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
				undeliveredCommand: "run the suite",
			}),
		);
		expect(h.openSession).not.toHaveBeenCalled();

		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult({
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
			}),
			nextCommand: "run the suite",
			sourceAttachments: [attachment],
			isThreadActive: () => true,
		});
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
			initialPromptDraft: "run the suite",
			initialAttachments: [attachment],
		});
	});

	it("RPC before its completion event keeps recovery payload after the target cannot open", async () => {
		const h = makeHarness({ openSessionResult: false });
		const attachment = makeAttachment();
		const handoffAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcResolved(SOURCE, {
			handoffAttemptId,
			result: makeResult({
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
			}),
			nextCommand: "run the suite",
			sourceAttachments: [attachment],
			isThreadActive: () => true,
		});

		await h.lifecycle.onEvent(
			completeEvent({
				handoffAttemptId,
				warningKind: "unqueued",
				undeliveredCommand: "run the suite",
			}),
		);

		expect(h.openSession).toHaveBeenCalledTimes(1);
		expect(h.getState()[SOURCE]).toEqual({
			status: "complete",
			receipt: { targetSessionId: TARGET, dashboardUrl: DASHBOARD_URL },
			externalPresentation: true,
			warningKind: "unqueued",
			retryDraft: "run the suite",
			retryAttachments: [attachment],
		});
	});

	it("duplicate completion events do not open or reopen the target", async () => {
		const h = makeHarness();
		const event = completeEvent({
			warningKind: "unqueued",
			undeliveredCommand: "run the suite",
		});
		await h.lifecycle.onEvent(event);
		await h.lifecycle.onEvent(event);
		expect(h.openSession).not.toHaveBeenCalled();
	});

	it("ignores mismatched and uncorrelated completions after a newer attempt is accepted", async () => {
		const h = makeHarness();
		const currentAttachment = makeAttachment("current.png");
		const staleAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		const currentAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onEvent({
			sourceSessionId: SOURCE,
			handoffAttemptId: currentAttemptId,
			phase: "creating",
		});
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: currentAttemptId,
			error: new Error("current attempt failed"),
			nextCommand: "current command",
			sourceAttachments: [currentAttachment],
		});

		await h.lifecycle.onEvent(
			completeEvent({
				handoffAttemptId: staleAttemptId,
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
				undeliveredCommand: "stale command",
			}),
		);
		await h.lifecycle.onEvent(
			completeEvent({
				warningKind: "unqueued",
				undeliveredCommand: "untagged stale command",
			}),
		);
		expect(h.openSession).not.toHaveBeenCalled();
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "failed",
			retryDraft: "/handoff current command",
			retryAttachments: [currentAttachment],
		});
	});

	it("keeps the edited retry payload after consecutive preflight failures", async () => {
		const h = makeHarness();
		const originalAttachment = makeAttachment("original.png");
		const retryAttachment = makeAttachment("retry.png");
		const originalAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: originalAttemptId,
			error: new Error("first preflight failed"),
			nextCommand: "original command",
			sourceAttachments: [originalAttachment],
		});

		const retryAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: retryAttemptId,
			error: new Error("retry preflight failed"),
			nextCommand: "edited retry command",
			sourceAttachments: [retryAttachment],
		});

		expect(h.getState()[SOURCE]).toMatchObject({
			status: "failed",
			retryDraft: "/handoff edited retry command",
			retryAttachments: [retryAttachment],
		});
	});

	it("restores only the matching payload when an older timed-out attempt completes", async () => {
		const h = makeHarness();
		const originalAttachment = makeAttachment("original.png");
		const retryAttachment = makeAttachment("retry.png");
		const originalAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: originalAttemptId,
			error: new Error("request timed out"),
			nextCommand: "original command",
			sourceAttachments: [originalAttachment],
		});

		const retryAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: retryAttemptId,
			error: new Error(
				"A different cloud handoff is already in progress for this session.",
			),
			nextCommand: "retry command",
			sourceAttachments: [retryAttachment],
		});
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "failed",
			retryDraft: "/handoff retry command",
			retryAttachments: [retryAttachment],
		});

		await h.lifecycle.onEvent(
			completeEvent({
				handoffAttemptId: originalAttemptId,
				warningKind: "unqueued",
			}),
		);
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
			initialPromptDraft: "original command",
			initialAttachments: [originalAttachment],
		});
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			retryDraft: "retry command",
			retryAttachments: [retryAttachment],
		});
	});

	it("does not carry a bare newer handoff command into an older target", async () => {
		const h = makeHarness();
		const originalAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: originalAttemptId,
			error: new Error("request timed out"),
			nextCommand: "original command",
			sourceAttachments: [],
		});

		const retryAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: retryAttemptId,
			error: new Error("retry preflight failed"),
			nextCommand: "",
			sourceAttachments: [],
		});

		await h.lifecycle.onEvent(
			completeEvent({ handoffAttemptId: originalAttemptId }),
		);
		expect(h.getState()[SOURCE]).toMatchObject({ status: "complete" });
		expect(h.getState()[SOURCE]).not.toHaveProperty("retryDraft");
	});

	it("retains attachment-only newer retries without a handoff command", async () => {
		const h = makeHarness();
		const retryAttachment = makeAttachment("retry.png");
		const originalAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: originalAttemptId,
			error: new Error("request timed out"),
			nextCommand: "original command",
			sourceAttachments: [],
		});

		const retryAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: retryAttemptId,
			error: new Error("retry preflight failed"),
			nextCommand: "",
			sourceAttachments: [retryAttachment],
		});

		await h.lifecycle.onEvent(
			completeEvent({ handoffAttemptId: originalAttemptId }),
		);
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			retryAttachments: [retryAttachment],
		});
		expect(h.getState()[SOURCE]).not.toHaveProperty("retryDraft");
	});

	it("clears a rejected attempt's payload when its clean completion arrives", async () => {
		const h = makeHarness();
		const attemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: attemptId,
			error: new Error("response lost"),
			nextCommand: "already queued",
			sourceAttachments: [makeAttachment()],
		});

		await h.lifecycle.onEvent(completeEvent({ handoffAttemptId: attemptId }));

		expect(h.getState()[SOURCE]).toEqual({
			status: "complete",
			receipt: { targetSessionId: TARGET, dashboardUrl: DASHBOARD_URL },
			externalPresentation: false,
		});
		expect(h.openSession).not.toHaveBeenCalled();
	});

	it("accepts a matching retry completion even when all of its progress was lost", async () => {
		const h = makeHarness();
		const originalAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onEvent({
			sourceSessionId: SOURCE,
			handoffAttemptId: originalAttemptId,
			phase: "creating",
		});
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: originalAttemptId,
			error: new Error("original request timed out"),
			nextCommand: "original command",
			sourceAttachments: [makeAttachment("original.png")],
		});

		const retryAttachment = makeAttachment("retry.png");
		const retryAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: retryAttemptId,
			error: new Error("retry transport failed"),
			nextCommand: "retry command",
			sourceAttachments: [retryAttachment],
		});

		await h.lifecycle.onEvent(
			completeEvent({
				handoffAttemptId: retryAttemptId,
				warningKind: "unqueued",
			}),
		);
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
			initialPromptDraft: "retry command",
			initialAttachments: [retryAttachment],
		});
		expect(h.getState()[SOURCE]).toMatchObject({ status: "complete" });
	});

	it("does not let an older completion overwrite a retry accepted while its target open awaited", async () => {
		const h = makeHarness();
		let resolveOpen: ((opened: boolean) => void) | undefined;
		h.openSession.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					resolveOpen = resolve;
				}),
		);
		const originalAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId: originalAttemptId,
			error: new Error("request timed out"),
			nextCommand: "original command",
			sourceAttachments: [],
		});

		const originalCompletion = h.lifecycle.onEvent(
			completeEvent({
				handoffAttemptId: originalAttemptId,
				warningKind: "unqueued",
			}),
		);
		await vi.waitFor(() => expect(h.openSession).toHaveBeenCalledTimes(1));

		const retryAttemptId = h.lifecycle.onRpcStarted(SOURCE);
		await h.lifecycle.onEvent({
			sourceSessionId: SOURCE,
			handoffAttemptId: retryAttemptId,
			phase: "creating",
			message: "Creating the retry",
		});
		resolveOpen?.(true);
		await originalCompletion;

		expect(
			h.dispatched.filter(
				(action) => action.type === "progress" && action.phase === "complete",
			),
		).toHaveLength(0);
		expect(h.dispatched.at(-1)).toMatchObject({
			type: "progress",
			sourceSessionId: SOURCE,
			phase: "creating",
			message: "Creating the retry",
		});
	});

	it("(d) event then reject in the same tick: restoration via the completions registry, benign toast, NO failed dispatch", async () => {
		const h = makeHarness();
		const attachment = makeAttachment();
		// The completion event lands first (no warning string, so it toasts
		// nothing itself) and records the authoritative completion...
		h.lifecycle.onEvent(completeEvent({ warningKind: "unqueued" }));
		// ...then the RPC rejection arrives before any re-render could update
		// a reducer-fed ref: the caller passes no reducer entry.
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("socket closed"),
			nextCommand: "run the suite",
			sourceAttachments: [attachment],
			isThreadActive: () => true,
		});
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
			initialPromptDraft: "run the suite",
			initialAttachments: [attachment],
		});
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Handoff completed",
			description:
				"The connection dropped while reporting the result, but the cloud session is ready.",
		});
		expect(h.dispatched.filter((action) => action.type === "failed")).toEqual(
			[],
		);
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			receipt: { targetSessionId: TARGET, dashboardUrl: DASHBOARD_URL },
		});
	});

	it("event then reject without an unqueued warning: benign toast only, no restoration", async () => {
		const h = makeHarness();
		h.lifecycle.onEvent(completeEvent());
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("socket closed"),
			nextCommand: "run the suite",
			sourceAttachments: [makeAttachment()],
			isThreadActive: () => true,
		});
		expect(h.openSession).not.toHaveBeenCalled();
		expect(h.toast).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ title: "Handoff completed" }),
		);
		expect(h.dispatched.filter((action) => action.type === "failed")).toEqual(
			[],
		);
	});

	it("event then reject: a false target-open result exposes the draft and attachments for recovery", async () => {
		const h = makeHarness({ openSessionResult: false });
		const attachment = makeAttachment();
		await h.lifecycle.onEvent(completeEvent({ warningKind: "unqueued" }));

		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("socket closed"),
			nextCommand: "run the suite",
			sourceAttachments: [attachment],
			isThreadActive: () => true,
		});
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
			initialPromptDraft: "run the suite",
			initialAttachments: [attachment],
		});
		expect(h.dispatched.at(-1)).toEqual({
			type: "target_open_failed",
			sourceSessionId: SOURCE,
			dashboardUrl: DASHBOARD_URL,
			retryDraft: "run the suite",
			retryAttachments: [attachment],
		});
		expect(h.getState()[SOURCE]).toEqual({
			status: "complete",
			receipt: { targetSessionId: TARGET, dashboardUrl: DASHBOARD_URL },
			externalPresentation: false,
			warningKind: "unqueued",
			retryDraft: "run the suite",
			retryAttachments: [attachment],
		});

		await h.lifecycle.onEvent(completeEvent({ warningKind: "unqueued" }));
		expect(h.openSession).toHaveBeenCalledTimes(1);
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			retryDraft: "run the suite",
			retryAttachments: [attachment],
		});
	});

	it("event then reject: a rejected target open exposes the draft and attachments for recovery", async () => {
		const h = makeHarness();
		const attachment = makeAttachment();
		h.openSession.mockRejectedValueOnce(new Error("discovery failed"));
		await h.lifecycle.onEvent(completeEvent({ warningKind: "unqueued" }));

		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("socket closed"),
			nextCommand: "run the suite",
			sourceAttachments: [attachment],
			isThreadActive: () => true,
		});
		expect(h.openSession).toHaveBeenCalledTimes(1);
		expect(h.getState()[SOURCE]).toEqual({
			status: "complete",
			receipt: { targetSessionId: TARGET, dashboardUrl: DASHBOARD_URL },
			externalPresentation: false,
			warningKind: "unqueued",
			retryDraft: "run the suite",
			retryAttachments: [attachment],
		});
	});

	it("ref-lag fallback: a reducer-fed complete entry drives restoration when the registry is empty", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("socket closed"),
			nextCommand: "run the suite",
			sourceAttachments: [],
			reducerEntryIsComplete: {
				receipt: { targetSessionId: TARGET, dashboardUrl: DASHBOARD_URL },
				externalPresentation: false,
				warningKind: "unqueued",
			},
			isThreadActive: () => true,
		});
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
			initialPromptDraft: "run the suite",
		});
		expect(h.toast).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ title: "Handoff completed" }),
		);
		expect(h.dispatched).toEqual([
			expect.objectContaining({
				type: "complete",
				retryDraft: "run the suite",
			}),
			{ type: "retry_delivered", sourceSessionId: SOURCE },
		]);
	});

	it("registry completion wins over a conflicting reducer entry", async () => {
		const h = makeHarness();
		h.lifecycle.onEvent(completeEvent({ warningKind: "unqueued" }));
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("socket closed"),
			nextCommand: "run the suite",
			sourceAttachments: [],
			// A stale reducer entry pointing elsewhere must lose to the
			// synchronously recorded completion.
			reducerEntryIsComplete: {
				receipt: {
					targetSessionId: "stale-target",
					dashboardUrl: "https://app.cline.bot/agents/stale",
				},
				externalPresentation: false,
				warningKind: "unqueued",
			},
			isThreadActive: () => true,
		});
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(
			TARGET,
			expect.objectContaining({ initialPromptDraft: "run the suite" }),
		);
	});

	it("completed externally: no restoration open, benign toast still shown", async () => {
		const h = makeHarness();
		const attachment = makeAttachment();
		h.lifecycle.onEvent(
			completeEvent({ destination: "external", warningKind: "unqueued" }),
		);
		h.openSession.mockClear();
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("socket closed"),
			nextCommand: "run the suite",
			sourceAttachments: [attachment],
			isThreadActive: () => true,
		});
		expect(h.openSession).not.toHaveBeenCalled();
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			retryDraft: "run the suite",
			retryAttachments: [attachment],
		});
		expect(h.toast).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Handoff completed" }),
		);
	});

	it("completed but the source thread went inactive: no restoration open", async () => {
		const h = makeHarness();
		const attachment = makeAttachment();
		h.lifecycle.onEvent(completeEvent({ warningKind: "unqueued" }));
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("socket closed"),
			nextCommand: "run the suite",
			sourceAttachments: [attachment],
			isThreadActive: () => false,
		});
		expect(h.openSession).not.toHaveBeenCalled();
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			retryDraft: "run the suite",
			retryAttachments: [attachment],
		});
		expect(h.toast).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ title: "Handoff completed" }),
		);
	});

	it("(e) reject then event: recovery stays available until the target opens with the saved draft and attachments", async () => {
		const h = makeHarness();
		const attachment = makeAttachment();
		let resolveOpen: ((opened: boolean) => void) | undefined;
		h.openSession.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					resolveOpen = resolve;
				}),
		);
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("fetch failed"),
			nextCommand: "fix flaky test",
			sourceAttachments: [attachment],
			isThreadActive: () => true,
		});
		expect(h.dispatched).toEqual([
			{
				type: "failed",
				sourceSessionId: SOURCE,
				exposeRecovery: true,
				retryDraft: "/handoff fix flaky test",
				retryAttachments: [attachment],
			},
		]);
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Handoff failed",
			description:
				"Couldn’t reach Cline Cloud. Your local conversation is still available.",
			variant: "destructive",
		});
		expect(h.openSession).not.toHaveBeenCalled();

		const completion = h.lifecycle.onEvent(
			completeEvent({
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
			}),
		);
		await vi.waitFor(() => expect(h.openSession).toHaveBeenCalledTimes(1));
		// Do not replace the recoverable failure while the open outcome is
		// unknown: these File objects otherwise have no durable owner.
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "failed",
			retryDraft: "/handoff fix flaky test",
			retryAttachments: [attachment],
		});
		resolveOpen?.(true);
		await completion;
		// The retry registry (written synchronously at rejection) is the only
		// carrier of the unsent command and attachments once the reducer's
		// failed entry has been replaced by the receipt.
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
			initialPromptDraft: "fix flaky test",
			initialAttachments: [attachment],
		});
		expect(warningToastCount(h.toast)).toBe(1);
		expect(h.toast).toHaveBeenCalledTimes(2);
		// The receipt wins in the reducer: the failed entry is replaced.
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			receipt: { targetSessionId: TARGET, dashboardUrl: DASHBOARD_URL },
			warningKind: "unqueued",
		});
	});

	it("reject then delayed event keeps recovery when the source thread is no longer active", async () => {
		const h = makeHarness({ openSessionResult: false });
		const attachment = makeAttachment();
		const handoffAttemptId = h.lifecycle.onRpcStarted(SOURCE, "thread-a");
		await h.lifecycle.onRpcRejected(SOURCE, {
			handoffAttemptId,
			error: new Error("fetch failed"),
			nextCommand: "fix flaky test",
			sourceAttachments: [attachment],
			isThreadActive: () => false,
		});

		await h.lifecycle.onEvent(
			completeEvent({
				handoffAttemptId,
				warningKind: "unqueued",
			}),
		);

		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
			initialPromptDraft: "fix flaky test",
			initialAttachments: [attachment],
			expectedActiveThreadId: "thread-a",
		});
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			retryDraft: "fix flaky test",
			retryAttachments: [attachment],
		});
	});

	it("reject then event: a false target-open result preserves the recovery payload", async () => {
		const h = makeHarness({ openSessionResult: false });
		const attachment = makeAttachment();
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("fetch failed"),
			nextCommand: "fix flaky test",
			sourceAttachments: [attachment],
		});

		await h.lifecycle.onEvent(
			completeEvent({
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
			}),
		);
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
			initialPromptDraft: "fix flaky test",
			initialAttachments: [attachment],
		});
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			retryDraft: "fix flaky test",
			retryAttachments: [attachment],
		});

		await h.lifecycle.onEvent(
			completeEvent({
				warningKind: "unqueued",
				undeliveredCommand: "fix flaky test",
			}),
		);
		expect(h.openSession).toHaveBeenCalledTimes(1);
	});

	it("reject then event: a rejected target open preserves the recovery payload", async () => {
		const h = makeHarness();
		const attachment = makeAttachment();
		h.openSession.mockRejectedValueOnce(new Error("discovery failed"));
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("fetch failed"),
			nextCommand: "fix flaky test",
			sourceAttachments: [attachment],
		});

		await h.lifecycle.onEvent(
			completeEvent({
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
			}),
		);
		expect(h.openSession).toHaveBeenCalledTimes(1);
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			retryDraft: "fix flaky test",
			retryAttachments: [attachment],
		});
	});

	it("reject then event: the event's undeliveredCommand overrides the recorded retry command", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("fetch failed"),
			nextCommand: "recorded command",
			sourceAttachments: [],
		});
		await h.lifecycle.onEvent(
			completeEvent({
				warningKind: "unqueued",
				undeliveredCommand: "authoritative command",
			}),
		);
		expect(h.openSession).toHaveBeenCalledExactlyOnceWith(TARGET, {
			silent: true,
			initialPromptDraft: "authoritative command",
		});
	});

	it("reject with an empty command and no attachments: a later unqueued event restores nothing", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("fetch failed"),
			nextCommand: "",
			sourceAttachments: [],
		});
		expect(h.dispatched).toEqual([
			{
				type: "failed",
				sourceSessionId: SOURCE,
				exposeRecovery: true,
				retryDraft: "/handoff",
				retryAttachments: [],
			},
		]);
		await h.lifecycle.onEvent(completeEvent({ warningKind: "unqueued" }));
		expect(h.openSession).not.toHaveBeenCalled();
	});

	it("the retry registry is consumed by the first unqueued completion", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("fetch failed"),
			nextCommand: "fix it",
			sourceAttachments: [],
		});
		await h.lifecycle.onEvent(completeEvent({ warningKind: "unqueued" }));
		expect(h.openSession).toHaveBeenCalledTimes(1);
		// A duplicate event finds the registry empty and restores nothing.
		await h.lifecycle.onEvent(completeEvent({ warningKind: "unqueued" }));
		expect(h.openSession).toHaveBeenCalledTimes(1);
	});
});

describe("cloud handoff lifecycle: warning toast claim", () => {
	it("(f) duplicate completion events surface exactly one warning toast", () => {
		const h = makeHarness();
		const event = completeEvent({
			warning: "The follow-up command could not be queued.",
			warningKind: "unqueued",
			undeliveredCommand: "do it",
		});
		h.lifecycle.onEvent(event);
		h.lifecycle.onEvent(event);
		expect(warningToastCount(h.toast)).toBe(1);
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Handoff completed with a warning",
			description:
				'The follow-up command could not be queued. Your command was kept: "do it" — send it from the cloud session.',
		});
	});

	it("(f) event completion then RPC result with the same warning: one warning toast total", async () => {
		const h = makeHarness();
		h.lifecycle.onEvent(
			completeEvent({
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
				undeliveredCommand: "do it",
			}),
		);
		expect(warningToastCount(h.toast)).toBe(1);
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult({
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
			}),
			nextCommand: "do it",
			sourceAttachments: [],
			isThreadActive: () => true,
		});
		expect(warningToastCount(h.toast)).toBe(1);
	});

	it("the RPC path claims the toast when it lands before any event", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcResolved(SOURCE, {
			result: makeResult({
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
			}),
			nextCommand: "do it",
			sourceAttachments: [],
			isThreadActive: () => true,
		});
		expect(warningToastCount(h.toast)).toBe(1);
		h.lifecycle.onEvent(
			completeEvent({
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
				undeliveredCommand: "do it",
			}),
		);
		expect(warningToastCount(h.toast)).toBe(1);
	});

	it("claims are per source session", () => {
		const h = makeHarness();
		const warning = "The follow-up command could not be queued.";
		h.lifecycle.onEvent(completeEvent({ warning, warningKind: "unqueued" }));
		h.lifecycle.onEvent(
			completeEvent({
				sourceSessionId: "local-2",
				sessionId: "cloud-2",
				dashboardUrl: "https://app.cline.bot/agents/cloud-2",
				warning,
				warningKind: "unqueued",
			}),
		);
		expect(warningToastCount(h.toast)).toBe(2);
	});
});

describe("cloud handoff lifecycle: event handling", () => {
	it("(g) external destination: no openSession restoration, toast quotes the command", () => {
		const h = makeHarness();
		h.lifecycle.onEvent(
			completeEvent({
				destination: "external",
				warning: "The follow-up command could not be queued.",
				warningKind: "unqueued",
				undeliveredCommand: "ship it",
			}),
		);
		expect(h.openSession).not.toHaveBeenCalled();
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Handoff completed with a warning",
			description:
				'The follow-up command could not be queued. Your command was kept: "ship it" — send it from the cloud session.',
		});
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "complete",
			externalPresentation: true,
			warningKind: "unqueued",
		});
	});

	it("does not open from an unqueued completion event without an RPC rejection", async () => {
		const h = makeHarness();
		await h.lifecycle.onEvent(
			completeEvent({
				warningKind: "unqueued",
				undeliveredCommand: "ship it",
			}),
		);
		expect(h.openSession).not.toHaveBeenCalled();
		expect(h.getState()[SOURCE]).toMatchObject({ status: "complete" });
	});

	it("forwards non-complete progress phases to the reducer verbatim", () => {
		const h = makeHarness();
		h.lifecycle.onEvent({
			sourceSessionId: SOURCE,
			phase: "seeding",
			message: "Transferring the conversation...",
			dashboardUrl: DASHBOARD_URL,
		});
		expect(h.dispatched).toEqual([
			{
				type: "progress",
				sourceSessionId: SOURCE,
				phase: "seeding",
				message: "Transferring the conversation...",
				dashboardUrl: DASHBOARD_URL,
				sessionId: undefined,
				destination: undefined,
				warningKind: undefined,
			},
		]);
		expect(h.toast).not.toHaveBeenCalled();
		expect(h.openSession).not.toHaveBeenCalled();
	});

	it("an unconfirmed completion event never restores and toasts destructively", () => {
		const h = makeHarness();
		h.lifecycle.onEvent(
			completeEvent({
				warning: "Cline could not confirm the follow-up was queued.",
				warningKind: "unconfirmed",
				undeliveredCommand: "must not resend",
			}),
		);
		expect(h.openSession).not.toHaveBeenCalled();
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Handoff completed with a warning",
			description: "Cline could not confirm the follow-up was queued.",
			variant: "destructive",
		});
	});
});

describe("cloud handoff lifecycle: RPC rejected with no completion", () => {
	it("(h) failed dispatch + failure toast with connectUrl passthrough", async () => {
		const h = makeHarness();
		const attachment = makeAttachment();
		const envelope = `CLOUD_SESSION_ERROR:${JSON.stringify({
			code: "github_not_connected",
			message: "Connect GitHub to hand off this repository.",
			connectUrl: "https://app.cline.bot/dashboard/integrations",
		})}`;
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error(envelope),
			nextCommand: "open a PR",
			sourceAttachments: [attachment],
			isThreadActive: () => true,
		});
		expect(h.dispatched).toEqual([
			{
				type: "failed",
				sourceSessionId: SOURCE,
				exposeRecovery: true,
				retryDraft: "/handoff open a PR",
				retryAttachments: [attachment],
			},
		]);
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Handoff failed",
			description: "Connect GitHub to hand off this repository.",
			variant: "destructive",
			connectUrl: "https://app.cline.bot/dashboard/integrations",
		});
		expect(h.openSession).not.toHaveBeenCalled();
		expect(h.getState()[SOURCE]).toMatchObject({
			status: "failed",
			retryDraft: "/handoff open a PR",
		});
	});

	it("omits connectUrl for a plain error and stringifies non-Error rejections", async () => {
		const h = makeHarness();
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: "plain failure",
			nextCommand: "",
			sourceAttachments: [],
		});
		expect(h.toast).toHaveBeenCalledExactlyOnceWith({
			title: "Handoff failed",
			description: "plain failure",
			variant: "destructive",
		});
	});

	it("preserves the recovery URL when the reducer already saw progress", async () => {
		const h = makeHarness();
		h.lifecycle.onEvent({
			sourceSessionId: SOURCE,
			phase: "seeding",
			dashboardUrl: DASHBOARD_URL,
		});
		await h.lifecycle.onRpcRejected(SOURCE, {
			error: new Error("boom"),
			nextCommand: "retry me",
			sourceAttachments: [],
		});
		// Reducer interplay: exposeRecovery + a known dashboardUrl produces a
		// recovery entry carrying the retry draft.
		expect(h.getState()[SOURCE]).toEqual({
			status: "recovery",
			dashboardUrl: DASHBOARD_URL,
			retryDraft: "/handoff retry me",
			retryAttachments: [],
		});
	});
});
