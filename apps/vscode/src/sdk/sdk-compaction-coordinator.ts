// Replaces classic manual-condense handling from src/core/task (see origin/main)
//
// Coordinates a manual "/compact" (alias "/smol") request triggered from the
// VSCode compact button or slash command. This mirrors the CLI's
// `compactCurrentSession` (apps/cli/src/runtime/interactive/session-runtime.ts):
//
//   1. Read the active session's transcript.
//   2. Run a manual SDK compaction over it (sdk-compaction.ts).
//   3. Restart the session with the compacted messages as initialMessages, so
//      the model's working context is actually reduced (reusing the mode-rebuild
//      replaceActiveSession path, which lazily persists on the next turn).
//
// Before this, the VSCode button sent the literal text "/compact" to the model,
// which the SDK does not treat as a runtime command, so the model improvised a
// fake "Conversation Summary" instead of compacting (CLINE-2503).

import type { Message as SdkMessage } from "@cline/llms"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import { historyItemToSessionMetadata } from "./session-metadata"
import { compactSessionMessages } from "./sdk-compaction"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkTaskHistory } from "./sdk-task-history"
import type { SdkInitialMessages, SdkSessionHost } from "./session-host"
import type { TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

export interface SdkCompactionCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	taskHistory: SdkTaskHistory
	sessionConfigBuilder: SdkSessionConfigBuilder
	getTask: () => TaskProxy | undefined
	createTempSessionHost: () => Promise<SdkSessionHost>
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (reader: SdkSessionHost, taskId: string) => Promise<unknown[] | undefined>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	setTurnPhase?: (phase: "awaiting_followup") => void
	resetMessageTranslator: () => void
	postStateToWebview: () => Promise<void>
}

export class SdkCompactionCoordinator {
	private compactInFlight = false

	constructor(private readonly options: SdkCompactionCoordinatorOptions) {}

	/**
	 * Compact the active session's conversation. Mirrors the CLI's `/compact`
	 * (alias `/smol`) local command. No-ops with a status message when there is
	 * no active session or nothing to compact.
	 */
	async compactTask(): Promise<void> {
		if (this.compactInFlight) {
			Logger.warn("[SdkController] compactTask: a compaction is already in progress; ignoring")
			return
		}

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			const task = this.options.getTask()
			if (!task) {
				Logger.warn("[SdkController] compactTask: No active session or displayed task to compact")
				this.emitInfo("There is no task to compact.")
				await this.options.postStateToWebview()
				return
			}

			await this.compactDisplayedTask(task)
			return
		}

		// A turn is still running; compacting mid-turn would race the live agent
		// loop's own message persistence. Ask the user to wait until it finishes.
		if (activeSession.isRunning) {
			this.emitInfo("Cannot compact while a response is in progress. Try again once the current turn finishes.")
			await this.options.postStateToWebview()
			return
		}

		this.compactInFlight = true
		try {
			await this.runCompaction(activeSession.sdkHost, activeSession.sessionId)
		} catch (error) {
			Logger.error("[SdkController] compactTask failed:", error)
			this.emitInfo(`Compaction failed: ${error instanceof Error ? error.message : String(error)}`)
			await this.options.postStateToWebview()
		} finally {
			this.compactInFlight = false
		}
	}

	private async compactDisplayedTask(task: TaskProxy): Promise<void> {
		this.compactInFlight = true
		try {
			const taskId = task.taskId
			Logger.log(`[SdkController] compactTask: compacting displayed history task ${taskId}`)

			const tempHost = await this.options.createTempSessionHost()
			let messages: SdkMessage[]
			try {
				messages = ((await this.options.loadInitialMessages(tempHost, taskId)) ?? []) as SdkMessage[]
			} finally {
				await tempHost.dispose("compactTask.readMessages")
			}

			await this.runCompactionForMessages(messages, taskId, async (config, compactedMessages, cwd, mode) => {
				const historyItem = await this.options.taskHistory.findHistoryItem(taskId)
				config.sessionId = taskId
				const startInput = this.options.buildStartSessionInput(config, { cwd, mode })
				const { startResult } = await this.options.sessions.startNewSession({
					...startInput,
					initialMessages: compactedMessages as InitialMessages,
					...(historyItem ? { sessionMetadata: historyItemToSessionMetadata(historyItem, config.modelId) } : {}),
				})
				this.options.sessions.setRunning(false)

				if (task.taskId !== startResult.sessionId) {
					task.taskId = startResult.sessionId
				}

				return startResult.sessionId
			})
		} catch (error) {
			Logger.error("[SdkController] Compaction failed:", error)
			this.emitInfo(`Compaction failed: ${error instanceof Error ? error.message : String(error)}`)
			await this.options.postStateToWebview()
		} finally {
			this.compactInFlight = false
		}
	}

	private async runCompaction(sdkHost: SdkSessionHost, sessionId: string): Promise<void> {
		const messages = (await sdkHost.readMessages(sessionId)) as SdkMessage[]
		await this.runCompactionForMessages(messages, sessionId, async (config, compactedMessages, cwd, mode) => {
			// Restart the session with the compacted transcript. Reusing the
			// sessionId keeps the task identity (history item, task header) stable;
			// replaceActiveSession waits for the old session's stop before starting
			// the replacement (same sequencing as a mode rebuild).
			config.sessionId = sessionId
			const startInput = this.options.buildStartSessionInput(config, { cwd, mode })
			const rebuildResult = await this.options.sessions.replaceActiveSession({
				startInput,
				initialMessages: compactedMessages as InitialMessages,
				disposeReason: "compactTask",
			})
			if (!rebuildResult) {
				this.emitInfo("Compaction could not be applied because the session was replaced.")
				await this.options.postStateToWebview()
				return undefined
			}

			const { startResult } = rebuildResult
			const task = this.options.getTask()
			if (task && task.taskId !== startResult.sessionId) {
				task.taskId = startResult.sessionId
			}

			return startResult.sessionId
		})
	}

	private async runCompactionForMessages(
		messages: SdkMessage[],
		sessionId: string,
		applyCompactedMessages: (
			config: SessionConfig,
			compactedMessages: SdkMessage[],
			cwd: string,
			mode: Mode,
		) => Promise<string | undefined>,
	): Promise<void> {
		const messagesBefore = messages.length
		if (messagesBefore === 0) {
			this.emitInfo("No messages to compact.")
			await this.options.postStateToWebview()
			return
		}

		const cwd = await this.options.getWorkspaceRoot()
		const mode = this.getCurrentMode()
		const config = await this.options.sessionConfigBuilder.build({ cwd, mode })

		const result = await compactSessionMessages({
			config: {
				providerConfig: config.providerConfig,
				providerId: config.providerId,
				modelId: config.modelId,
				knownModels: config.knownModels,
				compaction: config.compaction,
				logger: config.logger,
				telemetry: config.telemetry,
			},
			sessionId,
			messages,
		})

		if (!result.compacted) {
			this.emitInfo("No compaction needed.")
			await this.options.postStateToWebview()
			return
		}

		const appliedSessionId = await applyCompactedMessages(config, result.messages, cwd, mode)
		if (!appliedSessionId) {
			return
		}

		// Persist the compacted messages to disk so reopening the task later
		// shows the compacted transcript, not the original. startSession skips
		// persistence for "read-only resume" starts (same sessionId +
		// initialMessages + no prompt), so the host must write explicitly.
		const activeSession = this.options.sessions.getActiveSession()
		if (activeSession) {
			await activeSession.sdkHost.writeMessages(
				appliedSessionId,
				result.messages as SdkInitialMessages,
			)
		}

		// Fence the conversation boundary so any straggler events from the old
		// session carry an older epoch and are dropped by the webview.
		this.options.resetMessageTranslator()
		this.options.setTurnPhase?.("awaiting_followup")

		this.emitInfo(this.formatCompactionStatus(messagesBefore, result.messages.length))
		await this.options.postStateToWebview()

		Logger.log(
			`[SdkController] Compacted session ${sessionId}: ${messagesBefore} -> ${result.messages.length} messages (new session ${appliedSessionId})`,
		)
	}

	private getCurrentMode(): Mode {
		const m = this.options.stateManager.getGlobalSettingsKey("mode")
		return m === "plan" ? m : "act"
	}

	private formatCompactionStatus(messagesBefore: number, messagesAfter: number): string {
		// Mirrors apps/cli/src/tui/utils/compaction-status.ts wording.
		if (messagesBefore === messagesAfter) {
			return `Compacted context; message count stayed at ${messagesAfter}.`
		}
		return `Compacted ${messagesBefore} messages to ${messagesAfter}.`
	}

	private emitInfo(text: string): void {
		const sessionId = this.options.sessions.getActiveSession()?.sessionId ?? ""
		const infoMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "info",
			text,
			partial: false,
		}
		this.options.messages.appendAndEmit([infoMessage], {
			type: "status",
			payload: { sessionId, status: "running" },
		})
	}

}
