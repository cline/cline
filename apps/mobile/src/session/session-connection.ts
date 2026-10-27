/**
 * Owns the subscription, hydration, reducer state, and writes for one hub session.
 *
 * Startup order:
 * connect -> subscribe -> buffer events -> session.attach -> session.messages
 *         -> merge -> live
 *
 * Subscribing before hydration prevents lost events. Buffering until the snapshot
 * arrives prevents it from overwriting newer live events. reduceSession merges them.
 *
 * session.attach registers this client as a participant so it can list and answer
 * approvals. Its reply supplies the run status used during hydration.
 *
 * Each new connectionEpoch repeats this sequence, including recoveries that were
 * not externally visible. The merge retains unpersisted assistant content while a
 * run is active and reconciles buffered events with the persisted transcript.
 */

import {
	HubCommandError,
	type HubConnectionStateChange,
} from "@cline/hub-client";
import {
	HUB_APPROVAL_ALREADY_RESOLVED_ERROR_CODE,
	HUB_NOT_AUTHORIZED_ERROR_CODE,
	type HubEventEnvelope,
} from "@cline/shared";
import { userErrorMessage } from "../error-message";
import { type ApprovalPolicy, shouldAutoApprove } from "./approval-policy";
import { checkpointForkInput, listSessionCheckpoints } from "./checkpoints";
import type { SessionHandle } from "./cloud-resolver";
import type { HubSessionId } from "./ids";
import { type ReasoningChoice, reasoningUpdates } from "./reasoning";
import {
	createSessionState,
	optimisticMessageId,
	type RunStatus,
	reduceSession,
	type SessionAction,
	type SessionDiagnostic,
	type SessionState,
	type SessionViewModel,
	selectOptimisticInput,
	selectViewModel,
} from "./reducer";
import { restoreCloudSession } from "./restore-cloud-session";
import {
	type ModelCatalogView,
	parseAskQuestionCapabilityRequest,
	parseAskQuestionCapabilityResolution,
	parseHubEvent,
	parseModelCatalogReply,
	parsePendingApprovals,
	parseSessionMessagesReply,
	parseSessionRecordReply,
	pendingPromptsSchema,
	toPendingPromptView,
} from "./schemas";
export interface SessionConnectionOptions {
	handle: SessionHandle;
	onDiagnostic?: (diagnostic: SessionDiagnostic) => void;
	/**
	 * Per-tier auto-approve configuration (see {@link ApprovalPolicy}). Each
	 * pending approval is classified by tool name and auto-answered only when its
	 * tier is set to `"auto"`.
	 *
	 * Omitted means *every* tier asks, so a caller that never opts in keeps the
	 * fully interactive flow. The app passes the user's persisted policy.
	 */
	approvalPolicy?: ApprovalPolicy;
	getReasoningChoice?: () => ReasoningChoice | undefined;
	/** Consume an explicit choice only after its update is acknowledged. */
	onReasoningApplied?: (choice: ReasoningChoice) => void;
}

export interface SessionInputAttachments {
	userImages?: string[];
}

/** No policy supplied: nothing is auto-approved. */
const ASK_EVERYTHING: ApprovalPolicy = {
	read: "ask",
	write: "ask",
	execute: "ask",
};

/**
 * How many unattributable events to hold while the inner session id is unknown
 * (see {@link SessionConnection.onEvent}). The window is the `session.create`
 * round trip, so a handful is realistic; the cap exists so a hub that floods an
 * un-created session cannot grow this buffer without bound.
 */
const MAX_HELD_EVENTS = 200;

/**
 * How many times auto-approval may attempt one approval before retiring it and
 * leaving it for the user. Only transport-shaped failures are retried at all
 * (see {@link SessionConnection.handleAutoApproveFailure}).
 */
const MAX_AUTO_APPROVE_ATTEMPTS = 3;

/** First auto-approve retry delay; doubles per attempt. */
const AUTO_APPROVE_BACKOFF_MS = 500;

/**
 * The hub would not let this client act on the session, so `start()` gave up.
 *
 * Without an accepted `session.attach` the hub treats this client as unrelated to
 * the session: `approval.list_pending` reports nothing and `approval.respond` is
 * refused, which is a session that looks alive and answers nothing.
 */
export class SessionAttachError extends Error {
	constructor(
		readonly hubSessionId: string,
		readonly detail: string,
	) {
		super(`Could not attach to hub session ${hubSessionId}: ${detail}`);
		this.name = "SessionAttachError";
	}
}

/** Outcome of the `session.attach` step. */
type AttachOutcome =
	| { status: "skipped" }
	| { status: "attached"; runStatus?: RunStatus }
	| { status: "failed"; detail: string };

export class SessionConnection {
	private state: SessionState = createSessionState();
	private readonly viewListeners = new Set<(view: SessionViewModel) => void>();
	private view: SessionViewModel = selectViewModel(this.state);
	private unsubscribeEvents: (() => void) | undefined;
	private unsubscribeConnectionState: (() => void) | undefined;
	/** Highest `connectionEpoch` this connection has already resynced for. */
	private lastSeenEpoch = 0;
	/** Serialises resyncs: two epochs in flight must not interleave hydrates. */
	private resyncChain: Promise<void> = Promise.resolve();
	private runtimeRecovery: Promise<void> = Promise.resolve();
	private readonly recoveryAbort = new AbortController();
	private disposed = false;
	/** Events received before the owned session id was known; see `onEvent`. */
	private heldEvents: HubEventEnvelope[] = [];
	private pendingPromptsRevision = 0;
	private queuedTurnNeedsSnapshot = false;
	private lastSubmittedPromptId?: string;
	/** approvalIds already auto-answered, so auto-approve never double-responds. */
	private readonly autoAnswered = new Set<string>();
	/** Failed auto-approve attempts per approvalId, for the retry bound. */
	private readonly autoApproveAttempts = new Map<string, number>();
	/** approvalIds auto-approval has given up on; left for the user to answer. */
	private readonly autoApproveRetired = new Set<string>();
	/** Pending backoff timers, cleared on dispose. */
	private readonly autoApproveTimers = new Set<ReturnType<typeof setTimeout>>();
	/** Live policy: seeded from the options, replaceable via `setApprovalPolicy`. */
	private approvalPolicy: ApprovalPolicy;

	constructor(private readonly options: SessionConnectionOptions) {
		this.approvalPolicy = options.approvalPolicy ?? ASK_EVERYTHING;
	}

	get handle(): SessionHandle {
		return this.options.handle;
	}

	getView(): SessionViewModel {
		return this.view;
	}

	/** Subscribe to view-model updates. Returns an unsubscribe function. */
	subscribe(listener: (view: SessionViewModel) => void): () => void {
		this.viewListeners.add(listener);
		return () => {
			this.viewListeners.delete(listener);
		};
	}

	/** connect -> subscribe -> attach -> buffer -> hydrate -> merge -> live. */
	async start(options: { requireHydrate?: boolean } = {}): Promise<void> {
		if (this.disposed) {
			throw new Error("SessionConnection has been disposed.");
		}
		this.dispatch({ type: "connection_status", status: "connecting" });
		await this.handle.client.connect();
		// `connect()` awaits, and a dispose can land inside it. Registering listeners
		// on a closed client would only feed a disposed reducer.
		if (this.disposed) {
			return;
		}
		this.attachSubscription();
		this.watchConnectionState();
		// Seeded into the chain so a reconnect epoch observed *during* the initial
		// sync queues behind it instead of interleaving two hydrate windows.
		const initial = this.synchronize({ initial: true, ...options });
		this.runtimeRecovery = initial;
		this.resyncChain = initial.then(
			() => undefined,
			() => undefined,
		);
		await initial;
	}

	/**
	 * Re-run attach -> buffer -> hydrate -> merge on an already-subscribed
	 * connection.
	 *
	 * `HubClient` re-sends `stream.subscribe` inside `connect()` before that
	 * promise resolves, so by the time a reconnect is observable the subscription
	 * is already back: resync only has to redo the attach and hydrate halves.
	 *
	 * Always goes through {@link resyncChain}. This is the entry point a user-driven
	 * Retry reaches (via `SessionConnectionController.reconnect`), and running it
	 * directly overlapped two `synchronize` passes: the second `hydrate_started`
	 * cleared the buffer the first was about to merge, silently losing whatever had
	 * streamed in between.
	 */
	async resync(
		options: { requireAttach?: boolean; requireHydrate?: boolean } = {},
	): Promise<void> {
		if (this.disposed) {
			return;
		}
		await this.enqueueResync(options);
	}

	/**
	 * Sends user input, creating the inner hub session on first use.
	 *
	 * The optimistic user message is rendered immediately and reconciled against
	 * the transcript on the next hydrate. The returned promise follows the hub
	 * contract for `session.send_input`: immediate execution resolves when the run
	 * finishes; queue/steer admission resolves immediately, without an AgentResult.
	 * In the latter case the queue replaces this exact optimistic bubble.
	 *
	 * A transport drop mid-run therefore *rejects* this promise while the run
	 * carries on inside the sandbox. Callers should treat the rejection as "I lost
	 * the reply", not "the run failed"; the view model keeps tracking the run over
	 * the reconnected subscription, and the resync recovers the outcome.
	 *
	 * Either way the optimistic message is marked `failed` on rejection, which is
	 * the retry affordance: nothing is silently queued for later. If the input did
	 * reach the hub after all, the next hydrate finds it in the transcript and drops
	 * the local bubble, so the failed marking is self-correcting.
	 */
	async sendInput(
		text: string,
		attachments: SessionInputAttachments = {},
	): Promise<void> {
		this.dispatch({
			type: "user_input",
			text,
			...(attachments.userImages?.length
				? { userImages: attachments.userImages }
				: {}),
			timestamp: Date.now(),
		});
		await this.deliverInput(
			optimisticMessageId(this.state.inputSeq),
			text,
			attachments,
		);
	}

	/**
	 * Re-sends a failed optimistic message under its existing bubble.
	 *
	 * A no-op for anything that is not retryable — a send that never failed, or one
	 * the transcript has already caught up with — so a stale retry tap cannot
	 * duplicate a delivered prompt.
	 */
	async retrySend(messageId: string): Promise<void> {
		const input = selectOptimisticInput(this.state, messageId);
		if (input === undefined) {
			return;
		}
		this.dispatch({ type: "send_retried", messageId });
		await this.deliverInput(messageId, input.text, {
			...(input.userImages ? { userImages: input.userImages } : {}),
		});
	}

	async abort(reason?: string): Promise<void> {
		const sessionId = this.handle.hubSessionId;
		if (!sessionId) {
			return;
		}
		await this.run("run.abort", async () => {
			await this.handle.client.command(
				"run.abort",
				{ sessionId, ...(reason ? { reason } : {}) },
				sessionId,
			);
		});
	}

	/**
	 * Changes the model on this exact runtime session through ClineCore's existing
	 * connection-update command. On a fresh conversation this materializes the
	 * otherwise-lazy session first, so the selection is authoritative before the
	 * first prompt is sent.
	 */
	async updateModel(
		modelId: string,
		options: { providerId?: string } = {},
	): Promise<void> {
		if (this.preparingReasoning || this.updatingModel)
			throw new Error(
				"Wait for the thinking level to finish applying before changing model.",
			);
		const normalized = modelId.trim();
		if (!normalized) {
			throw new Error("Choose a model before applying the change.");
		}
		const providerId = options.providerId?.trim();
		this.updatingModel = true;
		try {
			const sessionId = await this.handle.ensureSession();
			this.drainHeldEvents();
			const previousModel = this.state.model;
			await this.run("session.update_connection", async () => {
				await this.handle.client.command(
					"session.update_connection",
					{
						sessionId,
						// The catalog spans providers, so a picked model carries its provider:
						// applying provider A's config with provider B's model id is exactly
						// the mispairing this prevents.
						updates: {
							modelId: normalized,
							...(providerId ? { providerId } : {}),
						},
					},
					sessionId,
				);
			});
			// Older deployed hubs acknowledge the update without broadcasting it.
			// Reflect the accepted selection now (including image capabilities), but
			// never replace a newer session.updated event received while awaiting it.
			if (!this.disposed && this.state.model === previousModel) {
				this.dispatch({
					type: "model_updated",
					model: {
						...previousModel,
						modelId: normalized,
						...(providerId ? { providerId } : {}),
					},
				});
			}
		} finally {
			this.updatingModel = false;
		}
	}

	async listCheckpoints() {
		const sessionId = this.handle.hubSessionId;
		return sessionId
			? listSessionCheckpoints(this.handle.client, sessionId)
			: [];
	}

	async prepareCheckpointFork(runCount: number) {
		await this.waitForRuntime();
		if (
			this.view.runStatus === "running" ||
			this.view.pendingPrompts.length ||
			this.view.pendingQuestions.length ||
			this.view.pendingApprovals.length
		)
			throw new Error(
				"Finish the current work before forking this conversation.",
			);
		const sessionId = this.handle.hubSessionId;
		if (!sessionId) throw new Error("This conversation has not started yet.");
		return checkpointForkInput(this.handle.client, sessionId, runCount);
	}

	/**
	 * The models the connected machine can actually run — `catalog.list`, the
	 * read half of model selection. Throws in words when the hub predates the
	 * command, so the sheet shows a sentence instead of an infinite spinner.
	 */
	async listModelCatalog(): Promise<ModelCatalogView> {
		const reply = await this.handle.client.command("catalog.list", {});
		const parsed = parseModelCatalogReply(reply.payload);
		if (parsed.status !== "ok") {
			throw new Error(
				`This computer's Cline is too old to list models (${parsed.detail}).`,
			);
		}
		return parsed.catalog;
	}

	/**
	 * Drops a prompt the machine is still holding in its turn queue.
	 *
	 * No optimistic removal: the hub re-broadcasts the whole queue as
	 * `session.pending_prompts` after any mutation, so the view converges from the
	 * authoritative snapshot. Removing locally first would flicker the entry back
	 * if the command were refused.
	 */
	async removePendingPrompt(promptId: string): Promise<void> {
		const sessionId = this.handle.hubSessionId;
		if (!sessionId) {
			return;
		}
		await this.run("session.remove_pending_prompt", async () => {
			await this.handle.client.command(
				"session.remove_pending_prompt",
				{ sessionId, promptId },
				sessionId,
			);
		});
	}

	/**
	 * Edits a queued prompt's text, its delivery, or both.
	 *
	 * Switching `delivery` to "steer" is how "do this now" works: the machine moves
	 * the entry to the front and injects it into the turn already running instead of
	 * waiting for it to finish.
	 */
	async updatePendingPrompt(
		promptId: string,
		changes: { prompt?: string; delivery?: "queue" | "steer" },
	): Promise<void> {
		const sessionId = this.handle.hubSessionId;
		if (!sessionId) {
			return;
		}
		await this.run("session.update_pending_prompt", async () => {
			await this.handle.client.command(
				"session.update_pending_prompt",
				{
					sessionId,
					promptId,
					...(changes.prompt === undefined ? {} : { prompt: changes.prompt }),
					...(changes.delivery ? { delivery: changes.delivery } : {}),
				},
				sessionId,
			);
		});
	}

	/**
	 * Answers a tool approval, always through the client that owns this session.
	 *
	 * Two refusals are handled rather than propagated blindly:
	 *
	 * - `already_resolved`: the approval was answered elsewhere, so it is dropped
	 *   locally and reported as info.
	 * - `not_authorized`: the hub has no participant record for this client. The
	 *   usual cause is a reconnect — the hub drops the record when the socket
	 *   closes — so re-attach the *current* client to its own session and answer
	 *   once more before giving up. `attachSession` uses `handle.hubSessionId`, so
	 *   the retry can only ever answer through the session's owner/participant.
	 *
	 * Anything else (and an answer that is still refused after a re-attach) is
	 * surfaced as a diagnostic and rethrown for the caller to treat as non-fatal.
	 */
	async respond(
		approvalId: string,
		approved: boolean,
		reason?: string,
	): Promise<void> {
		const payload = {
			approvalId,
			approved,
			...(reason ? { reason } : {}),
		};
		try {
			await this.waitForRuntime();
			// Session-scoped like every other command, so the hub can route/authorize
			// it against the session rather than inferring it from the approvalId.
			await this.handle.client.command(
				"approval.respond",
				payload,
				this.handle.hubSessionId,
			);
		} catch (error) {
			if (this.isAlreadyResolved(error)) {
				this.dispatch({
					type: "approval_dropped",
					approvalId,
					reason: "already_resolved",
				});
				return;
			}
			if (
				error instanceof HubCommandError &&
				error.code === HUB_NOT_AUTHORIZED_ERROR_CODE &&
				this.handle.hubSessionId
			) {
				const reattached = await this.attachSession();
				if (reattached.status === "attached") {
					await this.respondAfterReattach(approvalId, payload);
					return;
				}
			}
			this.emitCommandFailure("approval.respond", error);
			throw error;
		}
	}

	/** Answer the session's client-owned `ask_question` capability. */
	async respondQuestion(requestId: string, answer: string): Promise<void> {
		const normalized = answer.trim();
		const question = this.view.pendingQuestions.find(
			(entry) => entry.requestId === requestId,
		);
		if (!question || !normalized) {
			return;
		}
		const sessionId = this.handle.hubSessionId;
		if (!sessionId) {
			throw new Error("This question is no longer attached to a session.");
		}
		await this.run("capability.respond", async () => {
			await this.handle.client.command(
				"capability.respond",
				{ requestId, ok: true, payload: { result: normalized } },
				sessionId,
			);
		});
		this.dispatch({ type: "question_resolved", requestId });
	}

	/** The second `approval.respond` attempt, after a successful re-attach. */
	private async respondAfterReattach(
		approvalId: string,
		payload: Record<string, unknown>,
	): Promise<void> {
		try {
			await this.handle.client.command(
				"approval.respond",
				payload,
				this.handle.hubSessionId,
			);
		} catch (retryError) {
			if (this.isAlreadyResolved(retryError)) {
				this.dispatch({
					type: "approval_dropped",
					approvalId,
					reason: "already_resolved",
				});
				return;
			}
			this.emitCommandFailure("approval.respond", retryError);
			throw retryError;
		}
	}

	private isAlreadyResolved(error: unknown): boolean {
		return (
			error instanceof HubCommandError &&
			(error.code === HUB_APPROVAL_ALREADY_RESOLVED_ERROR_CODE ||
				error.code === "approval_not_found")
		);
	}

	/** Recovers approvals raised before this client was listening. */
	async refreshPendingApprovals(): Promise<void> {
		const client = this.handle.client;
		if (!client.hasCapability("approval.list_pending")) {
			return;
		}
		// Opened synchronously before the round trip so every approval event the
		// client sees while `list_pending` is in flight is buffered and replayed on
		// top of the snapshot, instead of being wiped by an older snapshot.
		this.dispatch({ type: "approvals_recovery_started" });
		// The generation this round trip belongs to. If another recovery opens while
		// this one is in flight, the reducer discards this reply rather than letting
		// a stale snapshot resurrect a resolved approval or drop a live one.
		const generation = this.state.approvalRecoveryGeneration;
		try {
			const listed = await client.listPendingApprovals(
				this.handle.hubSessionId,
			);
			const parsed = parsePendingApprovals(listed);
			if (parsed.invalidCount > 0) {
				this.dispatch({
					type: "diagnostic",
					diagnostic: {
						level: "warn",
						type: "invalid_pending_approvals",
						count: parsed.invalidCount,
					},
				});
			}
			this.dispatch({
				type: "approvals_recovered",
				approvals: parsed.approvals,
				generation,
			});
		} catch (error) {
			// A thrown/malformed reply must keep the existing pending set (a genuine
			// empty snapshot returns `[]`, it does not throw) and close the window.
			this.emitCommandFailure("approval.list_pending", error);
			this.dispatch({ type: "approvals_recovery_failed", generation });
		}
	}

	/**
	 * Tears the session down: stops watching the transport, unsubscribes and
	 * closes the hub client. Idempotent, and the client is closed because a
	 * connection owns the socket for the lifetime of the screen behind it.
	 */
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.recoveryAbort.abort();
		for (const timer of this.autoApproveTimers) {
			clearTimeout(timer);
		}
		this.autoApproveTimers.clear();
		this.heldEvents = [];
		// Unhooked before the close so the client's own terminal `closed` transition
		// cannot re-enter the reducer during teardown.
		this.unsubscribeConnectionState?.();
		this.unsubscribeConnectionState = undefined;
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = undefined;
		this.dispatch({ type: "connection_status", status: "closed" });
		this.handle.client.close();
	}

	// --- internals -------------------------------------------------------------

	private attachSubscription(): void {
		if (this.unsubscribeEvents) {
			return;
		}
		// Subscribed without a session filter: the inner session id may still be
		// unknown (a sandbox with no session yet), so filtering happens here.
		this.unsubscribeEvents = this.handle.client.subscribe((envelope) => {
			this.onEvent(envelope);
		});
	}

	/**
	 * Every event this connection accepts must belong to the session it owns.
	 *
	 * The subscription is deliberately unfiltered (the inner session id may not
	 * exist yet), so a hub that broadcasts more widely than it should — or simply
	 * multiplexes two clients over one sandbox — would otherwise put a stranger's
	 * `assistant.delta` in this transcript and, worse, their `approval.requested`
	 * in this approval sheet *and* the auto-approve queue. The hub-side broadcast
	 * ACL is the real fix; this is the client-side half that must not depend on it.
	 *
	 * While the id is unknown nothing can be attributed, so nothing is accepted:
	 * events are held and re-offered once the id lands (a `session.create` reply
	 * races the first events of the run it started), at which point ours are
	 * replayed in arrival order and the rest are discarded.
	 */
	private onEvent(envelope: HubEventEnvelope): void {
		if (this.disposed) {
			return;
		}
		const sessionId = this.handle.hubSessionId;
		if (!sessionId) {
			this.holdUnscopedEvent(envelope);
			return;
		}
		this.drainHeldEvents();
		if (envelope.sessionId && envelope.sessionId !== sessionId) {
			return;
		}
		if (
			envelope.event === "session.pending_prompts" ||
			envelope.event === "session.pending_prompt_submitted"
		) {
			this.pendingPromptsRevision += 1;
		}
		if (envelope.event === "capability.requested") {
			const parsed = parseAskQuestionCapabilityRequest(
				envelope.payload,
				this.handle.client.getClientId(),
			);
			if (parsed.status === "ok") {
				this.dispatch({
					type: "question_requested",
					question: parsed.question,
				});
			} else if (parsed.status === "invalid") {
				void this.handle.client
					.command(
						"capability.respond",
						{ requestId: parsed.requestId, ok: false, error: parsed.detail },
						sessionId,
					)
					.catch((error) => {
						this.emitCommandFailure("capability.respond", error);
					});
			}
			return;
		}
		if (envelope.event === "capability.resolved") {
			const requestId = parseAskQuestionCapabilityResolution(
				envelope.payload,
				this.handle.client.getClientId(),
			);
			if (requestId) {
				this.dispatch({ type: "question_resolved", requestId });
			}
			return;
		}
		this.dispatch({ type: "event", envelope });
		if (envelope.event === "session.pending_prompt_submitted") {
			const parsed = parseHubEvent(envelope);
			if (
				parsed.status !== "ok" ||
				parsed.event.name !== "session.pending_prompt_submitted"
			)
				return;
			const prompt = parsed.event.payload.prompt;
			if (prompt.id === this.lastSubmittedPromptId) return;
			this.lastSubmittedPromptId = prompt.id;
			// Match desktop's queued-prompt start: this is the hub's actual submitted
			// text (including edits), not the original local draft. Persistence can lag;
			// the existing user-message reconciliation merges it once snapshots catch up.
			this.dispatch({
				type: "user_input",
				text: prompt.prompt,
				userImages: Array.isArray(prompt.userImages)
					? prompt.userImages.filter(
							(image): image is string => typeof image === "string",
						)
					: undefined,
				timestamp: envelope.timestamp ?? Date.now(),
			});
			this.queuedTurnNeedsSnapshot = true;
			this.queueResync({ transcriptOnly: true });
		} else if (
			this.queuedTurnNeedsSnapshot &&
			["run.completed", "run.failed", "run.aborted"].includes(envelope.event) &&
			parseHubEvent(envelope).status === "ok"
		) {
			// Submission is emitted before execution/persistence. If that first read
			// raced the write, the terminal snapshot completes the reconciliation.
			this.queuedTurnNeedsSnapshot = false;
			this.queueResync({ transcriptOnly: true });
		}
	}

	/** Queues an event that cannot be attributed yet, oldest dropped on overflow. */
	private holdUnscopedEvent(envelope: HubEventEnvelope): void {
		this.heldEvents.push(envelope);
		if (this.heldEvents.length <= MAX_HELD_EVENTS) {
			return;
		}
		const dropped = this.heldEvents.length - MAX_HELD_EVENTS;
		this.heldEvents = this.heldEvents.slice(dropped);
		this.dispatch({
			type: "diagnostic",
			diagnostic: {
				level: "warn",
				type: "unowned_events_dropped",
				count: dropped,
			},
		});
	}

	/**
	 * Replays held events once the session id is known. Called from `onEvent` and
	 * from `deliverInput` after `ensureSession`, which is the moment the id
	 * actually appears on the fresh-session path.
	 */
	private drainHeldEvents(): void {
		const sessionId = this.handle.hubSessionId;
		if (!sessionId || this.heldEvents.length === 0) {
			return;
		}
		const held = this.heldEvents;
		this.heldEvents = [];
		for (const envelope of held) {
			// Capability requests need the same ownership checks and question handling
			// as events received after session.create returns.
			this.onEvent(envelope);
		}
	}

	/**
	 * One full synchronisation pass: buffer -> attach -> hydrate -> merge, plus the
	 * approval recovery that depends on the attach having succeeded.
	 *
	 * `hydrate_started` opens the buffering window *before* the attach so that every
	 * event from the attach onwards is replayed after the snapshot is applied.
	 * Otherwise an event landing between the attach reply and the hydrate would be
	 * overwritten by the older status the attach reported.
	 */
	private async synchronize(options: {
		initial: boolean;
		requireAttach?: boolean;
		requireHydrate?: boolean;
		transcriptOnly?: boolean;
	}): Promise<void> {
		this.dispatch({ type: "hydrate_started" });
		if (options.transcriptOnly) {
			// Queue changes do not replace the socket. Keep its newer lifecycle
			// events instead of overwriting completion with a lagging attach record.
			await this.hydrate(this.state.runStatus);
			await this.refreshPendingPrompts();
			return;
		}
		if (
			!options.initial &&
			this.handle.remoteSession.sandboxType === "resumable" &&
			this.handle.hubSessionId
		) {
			try {
				await restoreCloudSession(
					this.handle.client,
					this.handle.hubSessionId,
					this.handle.remoteSession.modelId,
					this.recoveryAbort.signal,
				);
			} catch (error) {
				this.dispatch({ type: "attach_failed", detail: errorDetail(error) });
				throw error;
			}
		}
		const attach = await this.attachSession();
		if (attach.status === "failed") {
			if (options.initial || options.requireAttach) {
				this.dispatch({ type: "attach_failed", detail: attach.detail });
				throw new SessionAttachError(
					this.handle.hubSessionId ?? "",
					attach.detail,
				);
			}
			// On a resync the transcript is still worth having: report it and carry on,
			// and the next reconnect epoch retries the attach.
			this.dispatch({
				type: "diagnostic",
				diagnostic: {
					level: "error",
					type: "attach_failed",
					detail: attach.detail,
				},
			});
		}
		await this.hydrate(
			attach.status === "attached" ? attach.runStatus : undefined,
			options.requireHydrate,
		);
		await this.refreshPendingApprovals();
		await this.refreshPendingPrompts();
		if (!options.initial) {
			this.dispatch({
				type: "diagnostic",
				diagnostic: { level: "info", type: "resynced" },
			});
		}
	}

	/**
	 * Declares this client a participant of the session.
	 *
	 * Required, not cosmetic: the hub authorizes `approval.list_pending` and
	 * `approval.respond` against the session's creator and attached participants, so
	 * a client that never attached sees no approvals and cannot answer any. It also
	 * re-runs on every resync, because the hub drops the participant record when the
	 * socket closes.
	 *
	 * The reply carries the session record, which is where the authoritative run
	 * status comes from.
	 */
	private async attachSession(): Promise<AttachOutcome> {
		const sessionId = this.handle.hubSessionId;
		if (!sessionId) {
			// No session to attach to. `session.create` records this client as the
			// creator, which grants the same relationship.
			return { status: "skipped" };
		}
		try {
			const reply = await this.handle.client.command(
				"session.attach",
				{ sessionId },
				sessionId,
			);
			const parsed = parseSessionRecordReply(reply.payload);
			if (parsed.status === "ok" && parsed.model) {
				this.dispatch({ type: "model_updated", model: parsed.model });
			}
			return {
				status: "attached",
				...(parsed.status === "ok" && parsed.runStatus
					? { runStatus: parsed.runStatus }
					: {}),
			};
		} catch (error) {
			return { status: "failed", detail: errorDetail(error) };
		}
	}

	/**
	 * Authoritative run status for a session, for the hydrate.
	 *
	 * Only used when the `session.attach` reply carried no readable record: a hub
	 * that answers attach without one still answers `session.get` with the record.
	 */
	private async fetchRunStatus(
		sessionId: HubSessionId,
	): Promise<RunStatus | undefined> {
		try {
			const reply = await this.handle.client.command(
				"session.get",
				{ sessionId },
				sessionId,
			);
			const parsed = parseSessionRecordReply(reply.payload);
			if (parsed.status === "ok" && parsed.model) {
				this.dispatch({ type: "model_updated", model: parsed.model });
			}
			return parsed.status === "ok" ? parsed.runStatus : undefined;
		} catch (error) {
			// Losing the status only costs us the stale-status correction, so this is a
			// warning rather than a failed hydrate.
			this.dispatch({
				type: "diagnostic",
				diagnostic: {
					level: "warn",
					type: "command_failed",
					command: "session.get",
					detail: errorDetail(error),
				},
			});
			return undefined;
		}
	}

	private async refreshPendingPrompts(): Promise<void> {
		const sessionId = this.handle.hubSessionId;
		if (!sessionId) return;
		// Like desktop, ask the command directly: the hub's advertised capability
		// list omits this supported command. Failed reads preserve the current queue.
		// Runs after hydrate has flushed its event buffer. Queue events contain the
		// whole list, so any mutation during this request supersedes the snapshot.
		const revision = this.pendingPromptsRevision;
		try {
			const reply = await this.handle.client.command(
				"session.pending_prompts",
				{ sessionId },
				sessionId,
			);
			const parsed = pendingPromptsSchema.safeParse(reply.payload);
			if (!parsed.success)
				throw new Error("Cline returned an unreadable prompt queue.");
			if (!this.disposed && revision === this.pendingPromptsRevision) {
				this.dispatch({
					type: "pending_prompts_recovered",
					prompts: parsed.data.prompts.map(toPendingPromptView),
				});
			}
		} catch (error) {
			this.emitCommandFailure("session.pending_prompts", error);
		}
	}

	private async hydrate(
		authoritative: RunStatus | undefined,
		required = false,
	): Promise<void> {
		const sessionId = this.handle.hubSessionId;
		if (!sessionId) {
			// Nothing persisted yet; go live so buffered events still render.
			this.dispatch({ type: "hydrated", messages: [] });
			return;
		}
		const runStatus = authoritative ?? (await this.fetchRunStatus(sessionId));
		try {
			const reply = await this.handle.client.command(
				"session.messages",
				{ sessionId },
				sessionId,
			);
			const parsed = parseSessionMessagesReply(reply.payload);
			if (parsed.status === "invalid") {
				this.dispatch({
					type: "diagnostic",
					diagnostic: {
						level: "warn",
						type: "invalid_hydrate_payload",
						detail: parsed.detail,
					},
				});
				// Treated as a *failed* hydrate rather than an empty one. Dispatching
				// `hydrated: []` here replaced the transcript with nothing and reset the
				// optimistic-send baseline, so a later good hydrate then read the whole
				// history as newly gained. `hydrate_failed` leaves both alone and still
				// flushes the buffer, so the client goes live either way.
				this.dispatch({
					type: "hydrate_failed",
					detail: parsed.detail,
				});
				if (required) throw new Error(parsed.detail);
				return;
			}
			if (parsed.invalidCount > 0) {
				this.dispatch({
					type: "diagnostic",
					diagnostic: {
						level: "warn",
						type: "invalid_hydrate_entries",
						count: parsed.invalidCount,
						detail: parsed.invalidDetail ?? "",
					},
				});
			}
			this.dispatch({
				type: "hydrated",
				messages: parsed.messages,
				...(runStatus ? { runStatus } : {}),
			});
		} catch (error) {
			this.dispatch({
				type: "hydrate_failed",
				detail: errorDetail(error),
			});
			if (required) throw error;
		}
	}

	/**
	 * Observes the transport instead of polling it.
	 *
	 * `connectionEpoch` is what makes this correct where an `isConnected()` poller
	 * was not: a drop and an internal recovery between two polls is invisible to
	 * `isConnected()`, but it still increments the epoch, so the resync happens.
	 */
	private watchConnectionState(): void {
		if (this.unsubscribeConnectionState) {
			return;
		}
		this.lastSeenEpoch = this.handle.client.getConnectionEpoch();
		this.unsubscribeConnectionState = this.handle.onConnectionState(
			(change) => {
				this.onConnectionStateChange(change);
			},
		);
	}

	private onConnectionStateChange(change: HubConnectionStateChange): void {
		if (this.disposed) {
			return;
		}
		switch (change.state) {
			case "connecting":
				// Reported once per attempt, including every reconnect attempt: mapping it
				// would flip a `reconnecting` view back to `connecting` on each retry.
				return;
			case "connected":
				if (change.connectionEpoch <= this.lastSeenEpoch) {
					return;
				}
				this.lastSeenEpoch = change.connectionEpoch;
				// A new socket invalidates client-owned questions even when the drop
				// happened too quickly for this observer to see a reconnecting state.
				if (this.view.pendingQuestions.length > 0) {
					this.dispatch({
						type: "transport_dropped",
						detail: "hub connection replaced",
					});
				}
				this.queueResync();
				return;
			case "reconnecting":
				this.dispatch({
					type: "transport_dropped",
					clearApprovals: !this.handle.client.hasCapability(
						"approval.list_pending",
					),
					detail:
						change.detail ?? change.error?.message ?? "hub connection lost",
				});
				return;
			case "closed":
				this.dispatch({
					type: "transport_dropped",
					clearApprovals: !this.handle.client.hasCapability(
						"approval.list_pending",
					),
					detail: change.detail ?? "hub connection closed",
				});
				this.dispatch({ type: "connection_status", status: "closed" });
				return;
		}
	}

	/** Runs resyncs one at a time, in epoch order, off the callback's stack. */
	private queueResync(options: { transcriptOnly?: boolean } = {}): void {
		void this.enqueueResync(options).catch(() => {
			// `synchronize` reports through diagnostics; a rejection here has nowhere
			// to go, and an epoch-driven resync has no caller to hand it to.
		});
	}

	/**
	 * Appends one `synchronize` pass to the chain and returns *that pass's* promise.
	 *
	 * The chain itself is kept rejection-free so one failed pass cannot poison every
	 * later resync, while the returned promise still settles with this pass's own
	 * outcome for whoever awaited `resync()`.
	 */
	private enqueueResync(
		options: {
			requireAttach?: boolean;
			requireHydrate?: boolean;
			transcriptOnly?: boolean;
		} = {},
	): Promise<void> {
		const pass = this.resyncChain.then(async () => {
			if (this.disposed) {
				return;
			}
			await this.synchronize({
				initial: false,
				...options,
			});
		});
		if (!options.transcriptOnly) this.runtimeRecovery = pass;
		this.resyncChain = pass.then(
			() => undefined,
			() => undefined,
		);
		return pass;
	}

	private async waitForRuntime(): Promise<void> {
		if (this.handle.remoteSession.sandboxType !== "resumable") return;
		await this.handle.client.connect();
		// A pod restart retains the transcript but loses its live agent. Wait for
		// recovery before issuing mutations, including a newer reconnect epoch.
		let recovery: Promise<void>;
		do {
			recovery = this.runtimeRecovery;
			await recovery;
		} while (recovery !== this.runtimeRecovery);
		if (this.disposed) throw new Error("Session connection has closed.");
	}

	private preparingReasoning = false;
	private updatingModel = false;
	private async deliverInput(
		messageId: string,
		text: string,
		attachments: SessionInputAttachments = {},
	): Promise<void> {
		try {
			await this.waitForRuntime();
			const sessionId = await this.handle.ensureSession();
			// The id just became knowable, so anything held during the create round
			// trip can now be attributed — before the send, so the run's own events
			// cannot overtake events that preceded them.
			this.drainHeldEvents();
			if (this.updatingModel)
				throw new Error(
					"The model is still changing. Retry this message in a moment.",
				);
			if (this.preparingReasoning)
				throw new Error(
					"Thinking level is still being applied. Retry this message in a moment.",
				);
			const reasoning = this.options.getReasoningChoice?.();
			if (reasoning) {
				const previousModel = this.state.model;
				this.preparingReasoning = true;
				try {
					await this.handle.client.command(
						"session.update_connection",
						{ sessionId, updates: reasoningUpdates(reasoning) },
						sessionId,
					);
					// Older hubs acknowledge without broadcasting session.updated. Keep
					// the accepted choice visible before consuming the pending edit,
					// unless a newer server model snapshot already arrived.
					if (!this.disposed && this.state.model === previousModel) {
						this.dispatch({
							type: "model_updated",
							model: { ...previousModel, reasoning },
						});
					}
					this.options.onReasoningApplied?.(reasoning);
				} catch {
					throw new Error(
						"The thinking level could not be applied. Your message was not sent. Try again.",
					);
				} finally {
					this.preparingReasoning = false;
				}
			}
			if (this.disposed)
				throw new Error("Session closed before the message was sent.");
			const reply = await this.handle.client.command(
				"session.send_input",
				{
					sessionId,
					prompt: text,
					...(attachments.userImages?.length
						? { attachments: { userImages: attachments.userImages } }
						: {}),
				},
				sessionId,
			);
			// RuntimeHost.runTurn returns undefined only for queue/steer admission;
			// immediate execution returns an AgentResult. Correlate via this RPC's
			// message id, never by prompt text (identical concurrent sends are valid).
			if (reply.payload?.result === undefined) {
				this.dispatch({ type: "send_queued", messageId });
				// Recover a queue broadcast lost during the send. A failed refresh must
				// not mark the accepted input retryable and invite a duplicate send.
				this.queueResync({ transcriptOnly: true });
			}
		} catch (error) {
			this.emitCommandFailure("session.send_input", error);
			this.dispatch({
				type: "send_failed",
				messageId,
				detail: errorDetail(error),
			});
			throw error;
		}
	}

	private async run(
		command: string,
		action: () => Promise<void>,
	): Promise<void> {
		try {
			await this.waitForRuntime();
			await action();
		} catch (error) {
			this.emitCommandFailure(command, error);
			throw error;
		}
	}

	private emitCommandFailure(command: string, error: unknown): void {
		this.dispatch({
			type: "diagnostic",
			diagnostic: {
				level: "error",
				type: "command_failed",
				command,
				detail: errorDetail(error),
			},
		});
	}

	private dispatch(action: SessionAction): void {
		this.state = reduceSession(this.state, action);
		for (const diagnostic of this.state.emitted) {
			try {
				this.options.onDiagnostic?.(diagnostic);
			} catch {
				// A diagnostics sink must never break the session.
			}
		}
		this.view = selectViewModel(this.state);
		for (const listener of [...this.viewListeners]) {
			try {
				listener(this.view);
			} catch {
				// Same for view listeners: a bad render must not stop the stream.
			}
		}
		this.maybeAutoApprove();
	}

	/** The policy currently in force. */
	getApprovalPolicy(): ApprovalPolicy {
		return this.approvalPolicy;
	}

	/**
	 * Swap the auto-approve policy mid-session.
	 *
	 * Applies to every later approval, and immediately answers anything already
	 * pending that the new policy permits — flipping a tier on while a run is
	 * blocked on that tier should unblock it, not require another tap.
	 */
	setApprovalPolicy(policy: ApprovalPolicy): void {
		this.approvalPolicy = policy;
		this.maybeAutoApprove();
	}

	/**
	 * Answer each newly pending approval exactly once, but only when the policy
	 * marks its tier `"auto"` — an unrecognised tool name is classified `execute`
	 * (see `approval-policy.ts`), so it is never auto-answered by accident.
	 *
	 * Fire-and-forget: `respond` handles its own failures (already_resolved,
	 * re-attach retry) and must never break the dispatch that scheduled it.
	 *
	 * A failure does **not** simply re-arm the attempt. This runs at the end of
	 * every dispatch, so re-arming on each rejection turned one persistently
	 * refused approval into a fresh concurrent `approval.respond` per incoming
	 * event, forever, on a streaming connection. Instead a rejection either retires
	 * the attempt for good (a hub-level refusal) or schedules one of a bounded
	 * number of backed-off retries; see {@link handleAutoApproveFailure}.
	 */
	private maybeAutoApprove(): void {
		if (this.disposed || this.view.connectionStatus !== "live") {
			return;
		}
		const pending = this.view.pendingApprovals;
		this.pruneAutoApproveState(
			new Set(pending.map((entry) => entry.approvalId)),
		);
		for (const approval of pending) {
			const approvalId = approval.approvalId;
			if (
				this.autoAnswered.has(approvalId) ||
				this.autoApproveRetired.has(approvalId)
			) {
				continue;
			}
			if (!shouldAutoApprove(approval.toolName, this.approvalPolicy)) {
				// Left for the user. Not recorded in `autoAnswered`, so a later policy
				// change can still pick it up.
				continue;
			}
			this.autoAnswered.add(approvalId);
			void this.respond(approvalId, true, "auto-approved").catch((error) => {
				this.handleAutoApproveFailure(approvalId, error);
			});
		}
	}

	/**
	 * Decides what a failed auto-approve costs.
	 *
	 * A {@link HubCommandError} is the hub having considered the request and said
	 * no (`not_authorized` above all: this client is not a participant, and
	 * `respond` already re-attached and asked again). Retrying cannot change that,
	 * so the approval is retired from auto-approval and left on screen for the user
	 * to answer — which is the safe direction for something that would otherwise
	 * run unattended.
	 *
	 * Everything else is transport-shaped — the socket is down, a reconnect is in
	 * progress — and worth a small number of retries on an exponential backoff. The
	 * backoff also means `autoAnswered` stays set between attempts, so no dispatch
	 * in the meantime can start a second concurrent respond for the same approval.
	 */
	private handleAutoApproveFailure(approvalId: string, error: unknown): void {
		if (this.disposed) {
			return;
		}
		if (error instanceof HubCommandError) {
			this.autoApproveRetired.add(approvalId);
			return;
		}
		const attempts = (this.autoApproveAttempts.get(approvalId) ?? 0) + 1;
		this.autoApproveAttempts.set(approvalId, attempts);
		if (attempts >= MAX_AUTO_APPROVE_ATTEMPTS) {
			this.autoApproveRetired.add(approvalId);
			this.emitCommandFailure(
				"approval.respond",
				new Error(
					`auto-approve gave up after ${attempts} attempts; answer ${approvalId} manually`,
				),
			);
			return;
		}
		const delayMs = AUTO_APPROVE_BACKOFF_MS * 2 ** (attempts - 1);
		const timer = setTimeout(() => {
			this.autoApproveTimers.delete(timer);
			if (this.disposed) {
				return;
			}
			// Re-arm only now, so the retry is driven by the clock rather than by
			// however many events happened to stream in.
			this.autoAnswered.delete(approvalId);
			this.maybeAutoApprove();
		}, delayMs);
		this.autoApproveTimers.add(timer);
	}

	/**
	 * Drops bookkeeping for approvals that are no longer pending.
	 *
	 * Unbounded growth is the obvious reason, but the sharper one is id reuse: a
	 * restarted hub can hand out an approvalId this connection has already
	 * answered, and a permanent `autoAnswered` entry would make that new approval
	 * silently unanswerable.
	 */
	private pruneAutoApproveState(pendingIds: ReadonlySet<string>): void {
		for (const approvalId of this.autoAnswered) {
			if (!pendingIds.has(approvalId)) {
				this.autoAnswered.delete(approvalId);
			}
		}
		for (const approvalId of this.autoApproveRetired) {
			if (!pendingIds.has(approvalId)) {
				this.autoApproveRetired.delete(approvalId);
			}
		}
		for (const approvalId of this.autoApproveAttempts.keys()) {
			if (!pendingIds.has(approvalId)) {
				this.autoApproveAttempts.delete(approvalId);
			}
		}
	}
}

function errorDetail(error: unknown): string {
	return userErrorMessage(error, "Unexpected session error.");
}
