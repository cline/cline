/**
 * SdkCheckpointManager — Lean checkpoint manager for SDK-migrated tasks.
 *
 * Implements ICheckpointManager using RefCheckpointTracker (git plumbing
 * with custom refs in the user's workspace repo).
 */

import { findLast, findLastIndex } from "@shared/array"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { RefCheckpointTracker } from "./RefCheckpointTracker"
import type { ICheckpointManager } from "./types"

/** Minimal interface for reading/writing ClineMessages. */
export interface SdkCheckpointMessageAccess {
	getClineMessages(): ClineMessage[]
	setMessages(messages: ClineMessage[]): void
}

export interface SdkCheckpointManagerOptions {
	taskId: string
	workspaceRoot: string
	enableCheckpoints: boolean
	messageAccess: SdkCheckpointMessageAccess
	/**
	 * Called after a "task" or "taskAndWorkspace" restore to tear down the
	 * active SDK session. The next user message will create a fresh session
	 * loaded from the (now-truncated) saved messages, ensuring the LLM's
	 * conversation history matches the truncated ClineMessages.
	 */
	onSessionInvalidated?: () => Promise<void>
}

export class SdkCheckpointManager implements ICheckpointManager {
	private readonly taskId: string
	private readonly workspaceRoot: string
	private readonly enableCheckpoints: boolean
	private readonly messageAccess: SdkCheckpointMessageAccess
	private readonly onSessionInvalidated?: () => Promise<void>

	private tracker: RefCheckpointTracker | undefined
	private trackerInitPromise: Promise<RefCheckpointTracker | undefined> | undefined
	private initFailed = false

	constructor(options: SdkCheckpointManagerOptions) {
		this.taskId = options.taskId
		this.workspaceRoot = options.workspaceRoot
		this.enableCheckpoints = options.enableCheckpoints
		this.messageAccess = options.messageAccess
		this.onSessionInvalidated = options.onSessionInvalidated
	}

	private async ensureTracker(): Promise<RefCheckpointTracker | undefined> {
		if (this.tracker) return this.tracker
		if (this.initFailed) return undefined
		if (this.trackerInitPromise) return this.trackerInitPromise

		this.trackerInitPromise = RefCheckpointTracker.create(this.taskId, this.enableCheckpoints, this.workspaceRoot)
			.then((t) => {
				this.tracker = t
				if (!t) this.initFailed = true
				return t
			})
			.catch((err) => {
				Logger.error("[SdkCheckpointManager] Tracker init failed:", err)
				this.initFailed = true
				return undefined
			})
			.finally(() => {
				this.trackerInitPromise = undefined
			})

		return this.trackerInitPromise
	}

	async commit(): Promise<string | undefined> {
		if (!this.enableCheckpoints) return undefined
		const tracker = await this.ensureTracker()
		if (!tracker) return undefined

		try {
			const commitHash = await tracker.commit()
			if (!commitHash) return undefined

			// Write hash onto the most recent checkpoint_created message without a hash
			const messages = this.messageAccess.getClineMessages()
			const targetMsg = findLast(messages, (m) => m.say === "checkpoint_created" && !m.lastCheckpointHash)
			if (targetMsg) {
				targetMsg.lastCheckpointHash = commitHash
			} else {
				const last = messages[messages.length - 1]
				if (last) last.lastCheckpointHash = commitHash
			}
			return commitHash
		} catch (error) {
			Logger.error("[SdkCheckpointManager] commit failed:", error)
			return undefined
		}
	}

	async saveCheckpoint(isAttemptCompletionMessage?: boolean, completionMessageTs?: number): Promise<void> {
		if (!this.enableCheckpoints) return
		const commitHash = await this.commit()
		if (!commitHash) return

		if (isAttemptCompletionMessage) {
			const messages = this.messageAccess.getClineMessages()
			const completionMsg = completionMessageTs
				? messages.find((m) => m.ts === completionMessageTs)
				: findLast(messages, (m) => m.say === "completion_result")
			if (completionMsg) {
				completionMsg.lastCheckpointHash = commitHash
			}
		}
	}

	async restoreCheckpoint(messageTs: number, restoreType: any, offset?: number): Promise<any> {
		const messages = this.messageAccess.getClineMessages()
		const messageIndex = messages.findIndex((m) => m.ts === messageTs) - (offset || 0)
		const message = messages[messageIndex]

		if (!message) {
			Logger.error(`[SdkCheckpointManager] Message not found for ts=${messageTs}`)
			return
		}

		if (restoreType === "workspace" || restoreType === "taskAndWorkspace") {
			const hash = message.lastCheckpointHash
			if (hash) {
				const tracker = await this.ensureTracker()
				if (tracker) {
					try {
						await tracker.restore(hash)
					} catch (error) {
						Logger.error("[SdkCheckpointManager] Workspace restore failed:", error)
					}
				}
			} else {
				const prevIdx = findLastIndex(messages.slice(0, messageIndex), (m) => m.lastCheckpointHash !== undefined)
				const prevMsg = messages[prevIdx]
				if (prevMsg?.lastCheckpointHash) {
					const tracker = await this.ensureTracker()
					if (tracker) {
						try {
							await tracker.restore(prevMsg.lastCheckpointHash)
						} catch (error) {
							Logger.error("[SdkCheckpointManager] Workspace restore (fallback) failed:", error)
						}
					}
				}
			}
		}

		if (restoreType === "task" || restoreType === "taskAndWorkspace") {
			// Truncate messages to the checkpoint point (remove everything after)
			const truncated = messages.slice(0, messageIndex + 1)
			this.messageAccess.setMessages(truncated)
			Logger.info(
				`[SdkCheckpointManager] Task restore: truncated to ${truncated.length} messages (from ${messages.length})`,
			)

			// Save the truncated messages to disk so that when the session is
			// restarted it loads the truncated history (not the full history).
			try {
				const { saveClineMessages } = await import("@core/storage/disk")
				await saveClineMessages(this.taskId, truncated)
			} catch (err) {
				Logger.error("[SdkCheckpointManager] Failed to save truncated messages:", err)
			}

			// Invalidate the active SDK session so the next user message creates
			// a fresh session loaded from the truncated saved messages. Without
			// this, the LLM's conversation history would still contain the
			// deleted messages and the assistant would "remember" them.
			if (this.onSessionInvalidated) {
				try {
					await this.onSessionInvalidated()
				} catch (err) {
					Logger.error("[SdkCheckpointManager] Failed to invalidate session:", err)
				}
			}
		}
	}

	async doesLatestTaskCompletionHaveNewChanges(): Promise<boolean> {
		if (!this.enableCheckpoints) return false
		try {
			const messages = this.messageAccess.getClineMessages()
			const idx = findLastIndex(messages, (m) => m.say === "completion_result")
			const msg = messages[idx]
			if (!msg?.lastCheckpointHash) return false

			const tracker = await this.ensureTracker()
			if (!tracker) return false

			const prevCompletion = findLast(messages.slice(0, idx), (m) => m.say === "completion_result")
			const firstCp = messages.find((m) => m.say === "checkpoint_created")
			const prevHash = prevCompletion?.lastCheckpointHash ?? firstCp?.lastCheckpointHash
			if (!prevHash) return false

			return (await tracker.getDiffCount(prevHash, msg.lastCheckpointHash)) > 0
		} catch (error) {
			Logger.error("[SdkCheckpointManager] doesLatestTaskCompletionHaveNewChanges failed:", error)
			return false
		}
	}
}
