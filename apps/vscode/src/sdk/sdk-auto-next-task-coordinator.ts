// Automatic next-chat chaining after a task genuinely completes.
//
// Completion signal (the ONLY signal this reacts to): at turn end the session
// event coordinator resolves the authoritative UI turn phase to "completed"
// when the assistant declared completion through the SDK's completion tool
// (`submit_and_exit`, the SDK analog of original Cline's `attempt_completion`).
// A cancelled turn resolves to "resumable", an errored turn to "error", and a
// turn that merely stopped talking to "awaiting_followup" — none of those reach
// this coordinator, so cancellations, API failures, failed tools, task switches
// and history opens can never start a new chat.
//
// Handoff summary: `/newtask` is an alias of `/compact` in this repository (see
// src/shared/slashCommands.ts), i.e. an in-place context condense, not a
// new-chat handoff. The reusable summary mechanism it relies on is the SDK's
// conversation summarizer, exported as `summarizeConversation()` from
// @cline/core, which produces exactly the continuation note this feature needs:
// original goal, state of the work, decisions and constraints, verification
// performed, unfinished work and next steps. Exactly one summarizer request runs
// per handoff — never several.
//
// New chat: created through the controller's own `initTask` path, so the task
// gets a fresh session id, independent conversation history, the current
// workspace and the current provider/model configuration — identical to the
// user typing the prompt themselves. With summary transfer disabled the view
// returns to an empty new chat through the same transition as the New Task
// button (`clearTask`), which creates no prompt and no half-populated task. The
// completed task is never modified or removed from history.
//
// Scheduling: the "Scheduled Tasks" view owns a persisted QUEUE of chats
// (`scheduledTasks`), and the array order is the run order. Each finished turn
// starts the head — a real completion (the assistant used the completion tool)
// or a chat that simply stopped answering and is waiting for the user — so a
// queue of three runs across three consecutive finished turns: the chat a queued
// row starts can itself finish and start the next one. A
// queued row is explicit user intent, so it authorizes the handoff even with the
// `autoStartNextTask` setting off and it is exempt from the chain-depth ceiling.
// The queue is only spent when a row actually starts: a summary that fails, a
// task the user took over mid-handoff, or a pause leaves the rows in place for
// the next completion. `scheduledTasksPaused` gates the whole queue without
// discarding it, and each row can pin its own provider/model — applied as a
// task-level session override (cline-session-factory.ts) rather than by writing
// the user's global provider settings.
import { summarizeConversation } from "@cline/core"
import type { MessageWithMetadata } from "@cline/shared"
import { isCloudSessionId } from "@shared/cloud/cloud-sessions"
import { normalizeScheduledTasks, type ScheduledTask } from "@shared/scheduled-next-task"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { TaskModelSelection } from "./cline-session-factory"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import { readCurrentMessages } from "./session-host"

/**
 * Hard cap on consecutive auto-created chats. Every auto-chained task can
 * itself complete and chain again, so without a ceiling the feature could run
 * forever. A manual task start or resume resets the counter.
 */
export const MAX_AUTO_NEXT_TASK_CHAIN_DEPTH = 5

/** Lead-in of the auto-submitted prompt, matching the handoff format the feature documents. */
export const AUTO_NEXT_TASK_PROMPT_LEAD_IN = "Continue from the previous task."
const SUMMARY_LABEL = "Summary:"
// Labels the instruction the user typed into the "Schedule New Task" composer.
const NEXT_STEP_LABEL = "Next step you asked for:"

// The summarizer is a single model request over the whole transcript; the CLI's
// cloud-handoff call uses the same ceiling.
const SUMMARY_TIMEOUT_MS = 120_000
// Bounded so a long-lived window cannot grow the turn-end claim set without limit.
const MAX_TRACKED_HANDLED_TURNS = 100

export type AutoNextTaskNotificationKind = "information" | "warning"

export interface SdkAutoNextTaskCoordinatorOptions {
	stateManager: StateManager
	sessions: Pick<SdkSessionLifecycle, "getActiveSession">
	/** Same consistency boundary the `/compact` path uses for transcript reads. */
	rebuilds: Pick<SdkSessionRebuildScheduler, "runExclusive">
	sessionConfigBuilder: SdkSessionConfigBuilder
	getWorkspaceRoot: () => Promise<string>
	getCurrentMode: () => Mode
	/**
	 * The controller's normal task-creation entry point — never bypassed here.
	 * `modelSelection` pins the provider/model of one scheduled row for that task
	 * only; a manual chat leaves it undefined and inherits the current config.
	 */
	initTask: (prompt: string, modelSelection?: TaskModelSelection) => Promise<string | undefined>
	/** Returns the view to an empty new chat (the New Task button's transition). */
	clearTask: () => Promise<void>
	/** Brings the chat view forward when History or another view covers it. */
	showChatView: () => Promise<void>
	/** Short user notification; injected so it stays host-agnostic and testable. */
	notify: (message: string, kind: AutoNextTaskNotificationKind) => void
}

/**
 * Builds the first message of the next chat.
 *
 * The continuation note keeps the documented handoff format, and the message of
 * the queued row is appended as an explicit next step. An empty result means the
 * next chat should simply be empty.
 */
export function buildScheduledTaskPrompt(schedule: ScheduledTask | undefined, summary = ""): string {
	const parts: string[] = []
	const trimmedSummary = summary.trim()
	if (trimmedSummary) {
		parts.push(`${AUTO_NEXT_TASK_PROMPT_LEAD_IN}\n\n${SUMMARY_LABEL}\n${trimmedSummary}`)
	}
	const message = (schedule?.message ?? "").trim()
	if (message) {
		parts.push(trimmedSummary ? `${NEXT_STEP_LABEL}\n${message}` : message)
	}
	return parts.join("\n\n")
}

/** Builds the first message of an auto-chained chat from the completed task's continuation note. */
export function buildAutoNextTaskPrompt(summary: string): string {
	return buildScheduledTaskPrompt(undefined, summary)
}

/**
 * The provider/model a queued row pins, as the session-level override the
 * session factory understands. No pinned provider means no override: the chat
 * inherits whatever the user has configured when it starts.
 */
export function scheduledTaskModelSelection(schedule: ScheduledTask | undefined): TaskModelSelection | undefined {
	const providerId = schedule?.providerId?.trim()
	if (!providerId) {
		return undefined
	}
	const modelId = schedule?.modelId?.trim()
	return modelId ? { providerId, modelId } : { providerId }
}

export class SdkAutoNextTaskCoordinator {
	/**
	 * Turn ends this coordinator has already acted on, keyed `<sessionId>:<turnToken>`
	 * (the bare session id when a caller supplies no token). One turn end reaches the
	 * coordinator more than once (the `done` agent event and the session `ended`
	 * event both end a turn), so the claim is taken synchronously — before any
	 * await — to keep the transition idempotent, while separate turns of the same
	 * session stay allowed because a chat can keep answering and run the next row.
	 */
	private readonly handledTurns = new Set<string>()
	private inFlight = false
	/** One-shot handshake identifying the next `initTask` call as auto-chained. */
	private pendingChainHandoff = false

	constructor(private readonly options: SdkAutoNextTaskCoordinatorOptions) {}

	/** Number of auto-created chats started in a row (persisted across restarts). */
	get chainDepth(): number {
		const depth = this.options.stateManager.getGlobalStateKey("autoNextTaskChainDepth")
		return typeof depth === "number" && Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 0
	}

	/**
	 * Consumes the one-shot marker set when this coordinator starts a task, so
	 * the controller can tell an auto-chained start apart from a manual one and
	 * reset the chain depth only for the latter.
	 */
	consumeChainHandoff(): boolean {
		if (!this.pendingChainHandoff) {
			return false
		}
		this.pendingChainHandoff = false
		return true
	}

	/** Breaks the chain: a user-started or user-resumed task is unrelated work. */
	resetChainDepth(reason: string): void {
		this.pendingChainHandoff = false
		if (this.chainDepth === 0 && !this.options.stateManager.getGlobalStateKey("autoNextTaskParentTaskId")) {
			return
		}
		this.options.stateManager.setGlobalState("autoNextTaskChainDepth", 0)
		this.options.stateManager.setGlobalState("autoNextTaskParentTaskId", undefined)
		Logger.debug(`[AutoNextTask] Chain depth reset (${reason})`)
	}

	/** The queued chats, in run order. Anything untrusted in state is dropped. */
	getScheduledTasks(): ScheduledTask[] {
		return normalizeScheduledTasks(this.options.stateManager.getGlobalStateKey("scheduledTasks"))
	}

	/** Replaces the whole queue (the "Scheduled Tasks" view owns the order). */
	setScheduledTasks(tasks: ScheduledTask[]): void {
		this.options.stateManager.setGlobalState("scheduledTasks", normalizeScheduledTasks(tasks))
	}

	/** Whether the queue is paused, i.e. configured but not allowed to run. */
	getScheduledTasksPaused(): boolean {
		return this.options.stateManager.getGlobalStateKey("scheduledTasksPaused") === true
	}

	/** Pausing keeps every row exactly as configured; unpausing resumes them. */
	setScheduledTasksPaused(paused: boolean): void {
		if (this.getScheduledTasksPaused() === paused) {
			return
		}
		this.options.stateManager.setGlobalState("scheduledTasksPaused", paused)
		Logger.debug(`[AutoNextTask] Scheduled task queue ${paused ? "paused" : "resumed"}`)
	}

	/** The rows the completion handler may act on: the queue, unless it is paused. */
	private runnableScheduledTasks(): ScheduledTask[] {
		return this.getScheduledTasksPaused() ? [] : this.getScheduledTasks()
	}

	/** Removes one row once it has actually been started, so it never re-fires. */
	private removeScheduledTask(id: string, reason: string): void {
		const remaining = this.getScheduledTasks().filter((task) => task.id !== id)
		if (remaining.length === this.getScheduledTasks().length) {
			return
		}
		this.setScheduledTasks(remaining)
		Logger.debug(`[AutoNextTask] Scheduled task ${id} consumed (${reason})`)
	}

	/**
	 * Starts a queued chat immediately instead of waiting for a completion — the
	 * "Run now" action in the view. The row is spent either way, and the
	 * previous-task summary is only carried when the task in view is idle, so a
	 * running turn is never summarized mid-flight.
	 */
	async startScheduledTaskNow(schedule: ScheduledTask): Promise<string | undefined> {
		if (this.inFlight) {
			Logger.debug("[AutoNextTask] A chain transition is already in flight; ignoring run-now")
			return undefined
		}
		this.inFlight = true
		try {
			const activeSession = this.options.sessions.getActiveSession()
			const sessionId = activeSession?.sessionId
			const canSummarize =
				sessionId !== undefined &&
				!isCloudSessionId(sessionId) &&
				schedule.includeSummary &&
				this.canStillChain(sessionId)
			let summary = ""
			if (canSummarize) {
				try {
					summary = await this.summarizeCompletedTask(sessionId)
				} catch (error) {
					Logger.error(`[AutoNextTask] Failed to summarize for the run-now handoff ${sessionId}:`, error)
				}
			}
			const prompt = buildScheduledTaskPrompt(schedule, summary)
			this.removeScheduledTask(schedule.id, "started now")
			this.applyScheduledMode(schedule)
			if (!prompt) {
				await this.options.clearTask()
				this.recordChainLink(sessionId, 0)
				await this.options.showChatView().catch((error) => {
					Logger.error("[AutoNextTask] Failed to reveal the chat view:", error)
				})
				this.options.notify("Started a new chat as scheduled.", "information")
				return undefined
			}
			this.pendingChainHandoff = true
			const newTaskId = await this.options.initTask(prompt, scheduledTaskModelSelection(schedule))
			if (!newTaskId) {
				this.pendingChainHandoff = false
				Logger.error("[AutoNextTask] Failed to start the scheduled chat")
				return undefined
			}
			this.recordChainLink(sessionId, 0)
			this.options.notify("Started the scheduled chat.", "information")
			return newTaskId
		} catch (error) {
			Logger.error("[AutoNextTask] Failed to start the scheduled chat:", error)
			return undefined
		} finally {
			this.inFlight = false
		}
	}

	/** Applies the plan/act mode the row chose for its chat. */
	private applyScheduledMode(schedule: ScheduledTask | undefined): void {
		if (!schedule || schedule.mode === this.options.getCurrentMode()) {
			return
		}
		this.options.stateManager.setGlobalState("mode", schedule.mode)
		Logger.debug(`[AutoNextTask] Scheduled chat starts in ${schedule.mode} mode`)
	}

	/**
	 * Whether chaining may still act on `sessionId`: the completed task must
	 * still be the task in view and must not have been picked up again by the
	 * user (follow-up message, queued prompt, history open or New Task). Checked
	 * before the handoff starts and again after the summarizer resolves, so an
	 * asynchronous summary can never replace a transition the user made meanwhile.
	 */
	private canStillChain(sessionId: string): boolean {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession || activeSession.sessionId !== sessionId) {
			return false
		}
		if (activeSession.isRunning || activeSession.queuedPromptCount > 0) {
			return false
		}
		return true
	}

	/**
	 * Records the previous-task -> next-task link and the chain depth after the
	 * handoff, so the chain safeguard survives an extension restart. A queued
	 * (user-intent) chat restarts the count at 0.
	 */
	private recordChainLink(completedSessionId: string | undefined, nextDepth: number): void {
		this.options.stateManager.setGlobalState("autoNextTaskChainDepth", nextDepth)
		this.options.stateManager.setGlobalState("autoNextTaskParentTaskId", completedSessionId)
	}

	/** Runs the existing `/newtask`-family summarizer over the completed conversation. */
	private summarizeCompletedTask(sessionId: string): Promise<string> {
		return this.options.rebuilds.runExclusive(async () => {
			const activeSession = this.options.sessions.getActiveSession()
			if (!activeSession || activeSession.sessionId !== sessionId) {
				throw new Error(`Task ${sessionId} is no longer the active session`)
			}
			const messages = (await readCurrentMessages(activeSession.sdkHost, sessionId)) as MessageWithMetadata[]
			if (messages.length === 0) {
				throw new Error(`Task ${sessionId} has no conversation to summarize`)
			}
			const cwd = await this.options.getWorkspaceRoot()
			const config = await this.options.sessionConfigBuilder.build({ cwd, mode: this.options.getCurrentMode() })
			return summarizeConversation({
				messages,
				signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
				config: {
					providerId: config.providerId,
					modelId: config.modelId,
					apiKey: config.apiKey,
					baseUrl: config.baseUrl,
					headers: config.headers,
					providerConfig: config.providerConfig,
				},
			})
		})
	}

	/**
	 * Called for every turn that ended by declaring completion. Runs when
	 * `autoStartNextTask` is on **or** when the "Scheduled Tasks" queue has a row
	 * to run, and never acts twice for one turn end. A paused queue never runs.
	 * `turnToken` identifies the turn (from the turn phase tracker's sequence), so
	 * the same chat can reach the next row on a later turn.
	 */
	async handleTaskCompleted(sessionId: string, turnToken?: number): Promise<void> {
		// A queued row is explicit user intent, so it authorizes the handoff by
		// itself even with the global setting off. It is always the head of the
		// queue: the array order is the run order.
		const scheduled = this.runnableScheduledTasks()[0]
		if (!this.options.stateManager.getGlobalSettingsKey("autoStartNextTask") && !scheduled) {
			return
		}
		await this.startNextChat(sessionId, turnToken, scheduled)
	}

	/**
	 * Called for a turn that ended with the agent just waiting for the user — the
	 * shape of a question-and-answer chat that never used the completion tool. The
	 * scheduled queue reacts to this too: as far as the user is concerned the chat
	 * is finished, so the task they queued should run next. Automatic chaining
	 * deliberately does not: `autoStartNextTask` still means "after a real
	 * completion".
	 */
	async handleTaskAwaitingFollowup(sessionId: string, turnToken?: number): Promise<void> {
		const scheduled = this.runnableScheduledTasks()[0]
		if (!scheduled) {
			return
		}
		await this.startNextChat(sessionId, turnToken, scheduled)
	}

	/** Shared handoff body for both turn-end shapes. */
	private async startNextChat(
		sessionId: string,
		turnToken: number | undefined,
		scheduled: ScheduledTask | undefined,
	): Promise<void> {
		if (this.inFlight) {
			Logger.debug("[AutoNextTask] A chain transition is already in flight; ignoring the turn end")
			return
		}
		// Cloud sandboxes own their lifecycle and their own notifications;
		// chaining one into a local chat would cross those boundaries.
		if (isCloudSessionId(sessionId)) {
			return
		}
		if (!this.canStillChain(sessionId)) {
			Logger.debug(`[AutoNextTask] ${sessionId} is no longer the idle task in view; not chaining a new chat`)
			return
		}
		// One claim per turn end, not per session: the `done` agent event and the
		// session `ended` event both end the same turn, while a chat the user keeps
		// talking in legitimately ends several turns and should reach the next row.
		const claimKey = turnToken === undefined ? sessionId : `${sessionId}:${turnToken}`
		if (this.handledTurns.has(claimKey)) {
			Logger.debug(`[AutoNextTask] Turn end already handled (${claimKey}); ignoring duplicate`)
			return
		}
		// Automatic chaining keeps the stricter invariant of one chained chat per
		// completed task, which also survives an extension-host reload where the
		// in-memory claims above are empty again. A queue is per-turn by design, and
		// its rows are finite, user-authored and pausable.
		if (!scheduled && this.options.stateManager.getGlobalStateKey("autoNextTaskParentTaskId") === sessionId) {
			Logger.debug(`[AutoNextTask] ${sessionId} already chained a new chat; ignoring replayed completion`)
			return
		}
		// Claim synchronously, before the first await, so a duplicate or racing
		// turn-end event can never start a second chat.
		this.handledTurns.add(claimKey)
		if (this.handledTurns.size > MAX_TRACKED_HANDLED_TURNS) {
			const oldest = this.handledTurns.values().next().value
			if (oldest !== undefined) {
				this.handledTurns.delete(oldest)
			}
		}

		this.inFlight = true
		try {
			if (!this.canStillChain(sessionId)) {
				Logger.debug(`[AutoNextTask] ${sessionId} is no longer the idle task in view; not chaining a new chat`)
				return
			}
			const depth = this.chainDepth
			// A queued row is explicit intent: it is exempt from the ceiling on
			// automatic chains, and it restarts the count.
			if (!scheduled && depth >= MAX_AUTO_NEXT_TASK_CHAIN_DEPTH) {
				Logger.log(
					`[AutoNextTask] Max chain depth (${MAX_AUTO_NEXT_TASK_CHAIN_DEPTH}) reached; not starting another chat`,
				)
				this.options.notify(
					`Automatic next chats stopped after ${MAX_AUTO_NEXT_TASK_CHAIN_DEPTH} tasks in a row. Start a new task to begin a fresh chain.`,
					"warning",
				)
				return
			}

			const includeSummary = scheduled
				? scheduled.includeSummary
				: (this.options.stateManager.getGlobalSettingsKey("includePreviousTaskSummary") ?? true)

			let summary = ""
			if (includeSummary) {
				try {
					summary = await this.summarizeCompletedTask(sessionId)
				} catch (error) {
					// Never open a chat seeded with a missing or partial summary:
					// keep the completed task on screen and say what went wrong.
					Logger.error(`[AutoNextTask] Failed to summarize completed task ${sessionId}:`, error)
					this.options.notify(
						"Task completed, but a new chat was not started because its summary could not be created.",
						"warning",
					)
					return
				}
				if (!summary.trim()) {
					Logger.warn(`[AutoNextTask] Empty summary for completed task ${sessionId}; not starting a new chat`)
					this.options.notify(
						"Task completed, but a new chat was not started because its summary could not be created.",
						"warning",
					)
					return
				}
			}

			if (!this.canStillChain(sessionId)) {
				// The user resumed this task, queued a prompt, switched tasks or
				// started a new chat while the summary was being written; their
				// transition wins.
				Logger.debug(`[AutoNextTask] ${sessionId} was taken over during the handoff; not chaining a new chat`)
				return
			}
			if (scheduled && this.getScheduledTasksPaused()) {
				// The queue was paused while its summary was being written: the
				// row stays queued for the next completion instead of starting now.
				Logger.debug("[AutoNextTask] The queue was paused during the handoff; leaving it queued")
				return
			}

			// The row is spent only once it is certain to start, so a failed
			// summary or a takeover above never swallows a scheduled chat.
			if (scheduled) {
				this.removeScheduledTask(scheduled.id, "consumed at completion")
				this.applyScheduledMode(scheduled)
			}

			const prompt = buildScheduledTaskPrompt(scheduled, summary)
			if (!prompt) {
				// Nothing to put in the next chat, so use the same transition as
				// the New Task button: an empty chat, never a fabricated task.
				await this.options.clearTask()
				this.recordChainLink(sessionId, scheduled ? 0 : depth + 1)
				await this.options.showChatView().catch((error) => {
					Logger.error("[AutoNextTask] Failed to reveal the chat view:", error)
				})
				this.options.notify(
					scheduled ? "Started a new chat as scheduled." : "Task completed. Started a new chat.",
					"information",
				)
				return
			}

			this.pendingChainHandoff = true
			const newTaskId = await this.options.initTask(prompt, scheduledTaskModelSelection(scheduled))
			if (!newTaskId) {
				// The controller reports a failed start: the completed task stays
				// as it is, and the chain is not credited.
				this.pendingChainHandoff = false
				Logger.error(`[AutoNextTask] Failed to start the next chat for completed task ${sessionId}`)
				return
			}
			this.recordChainLink(sessionId, scheduled ? 0 : depth + 1)
			await this.options.showChatView().catch((error) => {
				Logger.error("[AutoNextTask] Failed to reveal the chat view:", error)
			})
			const remaining = this.getScheduledTasks().length
			// Not phrased as "Task completed": the queue also runs after a chat
			// that simply finished answering, where nothing was declared complete.
			this.options.notify(
				scheduled
					? `Started the scheduled chat${remaining > 0 ? ` (${remaining} still queued)` : ""}.`
					: "Task completed. Starting a new chat with the previous task summary.",
				"information",
			)
		} catch (error) {
			Logger.error("[AutoNextTask] Failed to chain a new chat after task completion:", error)
		} finally {
			this.inFlight = false
		}
	}
}
