// Replaces classic manual-condense handling from src/core/task (see origin/main)
//
// Coordinates a manual "/compact" (alias "/smol") request triggered from the
// VSCode compact button or slash command. This mirrors the CLI's
// `compactCurrentSession` (apps/cli/src/runtime/interactive/session-runtime.ts):
//
//   1. Read the active session's transcript.
//   2. Run a manual SDK compaction over it (sdk-compaction.ts).
//   3. Persist the SDK compaction sidecar so the next turn and resumes keep
//      using the compacted working context.
//
// Before this, the VSCode button sent the literal text "/compact" to the model,
// which the SDK does not treat as a runtime command, so the model improvised a
// fake "Conversation Summary" instead of compacting (CLINE-2503).

import type { Message as SdkMessage } from "@cline/llms"
import type { ClineCompactionInfo, ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import { buildCompactionMessage, parseCompactionNoticeMetadata } from "./message-translator"
import { compactSessionMessages } from "./sdk-compaction"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionHost } from "./session-host"

const COMPACTION_FAILURE_MESSAGE = "Couldn't compact the conversation. Please try again."
const COMPACTION_UNSUPPORTED_MESSAGE = "Compaction is not supported by this runtime yet. Please update Cline and try again."

export interface SdkCompactionCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	sessionConfigBuilder: SdkSessionConfigBuilder
	getWorkspaceRoot: () => Promise<string>
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
			Logger.warn("[SdkController] compactTask: No active session to compact")
			this.emitInfo("There is no active task to compact.")
			await this.options.postStateToWebview()
			return
		}

		// A turn is still running; compacting mid-turn would race the live agent
		// loop's own message persistence. Ask the user to wait until it finishes.
		if (activeSession.isRunning) {
			this.emitInfo(
				"Cannot compact while a response is in progress. Try again once the current turn finishes.",
				activeSession.sessionId,
			)
			await this.options.postStateToWebview()
			return
		}

		this.compactInFlight = true
		try {
			await this.runCompaction(activeSession.sdkHost, activeSession.sessionId)
		} catch (error) {
			Logger.error("[SdkController] compactTask failed:", error)
			this.emitInfo(COMPACTION_FAILURE_MESSAGE, activeSession.sessionId)
			await this.options.postStateToWebview()
		} finally {
			this.compactInFlight = false
		}
	}

	private async runCompaction(sdkHost: SdkSessionHost, sessionId: string): Promise<void> {
		if (!sdkHost.updateSessionCompactionState) {
			this.emitInfo(COMPACTION_UNSUPPORTED_MESSAGE, sessionId)
			await this.options.postStateToWebview()
			return
		}
		const messages = (await sdkHost.readMessages(sessionId)) as SdkMessage[]
		const messagesBefore = messages.length
		if (messagesBefore === 0) {
			this.emitInfo("No messages to compact.", sessionId)
			await this.options.postStateToWebview()
			return
		}

		const cwd = await this.options.getWorkspaceRoot()
		const mode = this.getCurrentMode()
		const config = await this.options.sessionConfigBuilder.build({ cwd, mode })

		// A live divider row, updated in place (same ts) from "started" to its
		// terminal state — the same UX as the CLI's compaction divider.
		const compactionTs = Date.now()
		this.emitCompactionRow({ status: "started", mode: "manual" }, compactionTs, sessionId)
		await this.options.postStateToWebview()

		// The SDK reports the compaction's token/message counters through its
		// status notices; capture the terminal one for the final divider.
		let noticeInfo: ClineCompactionInfo | undefined
		try {
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
				emitStatusNotice: (_message, metadata) => {
					const parsed = parseCompactionNoticeMetadata(metadata)
					if (parsed && parsed.status !== "started") {
						noticeInfo = { ...parsed, mode: "manual" }
					}
				},
			})

			if (!result.compacted) {
				this.emitCompactionRow(noticeInfo ?? { status: "skipped", mode: "manual" }, compactionTs, sessionId)
				await this.options.postStateToWebview()
				return
			}

			if (!result.compactionState) {
				throw new Error("Compaction did not return durable state.")
			}
			const persisted = await sdkHost.updateSessionCompactionState(sessionId, result.compactionState)
			if (!persisted.updated) {
				throw new Error("Compaction sidecar could not be persisted.")
			}

			this.emitCompactionRow(
				noticeInfo?.status === "completed"
					? noticeInfo
					: {
							status: "completed",
							mode: "manual",
							messagesBefore,
							messagesAfter: result.messages.length,
						},
				compactionTs,
				sessionId,
			)
			await this.options.postStateToWebview()

			Logger.log(`[SdkController] Compacted session ${sessionId}: ${messagesBefore} -> ${result.messages.length} messages`)
		} catch (error) {
			this.emitCompactionRow({ status: "failed", mode: "manual" }, compactionTs, sessionId)
			throw error
		}
	}

	private getCurrentMode(): Mode {
		const m = this.options.stateManager.getGlobalSettingsKey("mode")
		return m === "plan" ? m : "act"
	}

	/** Append or update-in-place (same ts) the compaction divider row. */
	private emitCompactionRow(info: ClineCompactionInfo, ts: number, sessionId: string): void {
		const activeSessionId = this.options.sessions.getActiveSession()?.sessionId
		if (activeSessionId !== sessionId) {
			Logger.warn(`[SdkController] compactTask: skipped compaction row for inactive session ${sessionId}`)
			return
		}
		this.options.messages.appendAndEmit([buildCompactionMessage(info, ts)], {
			type: "status",
			payload: { sessionId, status: "running" },
		})
	}

	private emitInfo(text: string, sessionId?: string): void {
		const activeSessionId = this.options.sessions.getActiveSession()?.sessionId
		if (sessionId && activeSessionId !== sessionId) {
			Logger.warn(`[SdkController] compactTask: skipped info for inactive session ${sessionId}`)
			return
		}
		const targetSessionId = sessionId ?? activeSessionId ?? ""
		const infoMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "info",
			text,
			partial: false,
		}
		this.options.messages.appendAndEmit([infoMessage], {
			type: "status",
			payload: { sessionId: targetSessionId, status: "running" },
		})
	}
}
