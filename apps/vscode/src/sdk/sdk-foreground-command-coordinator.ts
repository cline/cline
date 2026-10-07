/**
 * Tracks in-flight foreground (VS Code terminal) command executions so the
 * "Proceed While Running" button can detach them: each pending tool call
 * returns with its partial output while the command keeps running in the
 * user's terminal, streaming further output to a log file.
 *
 * Owned by SdkController so it outlives session rebuilds (which recreate the
 * tool set and its reused executor closure). Handles are registered per tool
 * invocation — never on the reused executor — so parallel commands in one
 * tool call each get their own handle and log file.
 */

import { RunCommandExecutionController } from "@cline/core"
import { Logger } from "@/shared/services/Logger"

export interface ForegroundCommandHandle {
	/**
	 * Stop waiting for the command: flush the output captured so far to a
	 * log file, keep appending until the command completes, and resolve the
	 * pending tool execution with the partial output. Idempotent.
	 */
	detach(): void
}

export interface SdkForegroundCommandCoordinatorOptions {
	/** Called whenever isRunning flips; used to push the flag to the webview. */
	onRunningChanged?: (running: boolean) => void
}

export class SdkForegroundCommandCoordinator {
	// This controller is private to foreground executions; its routing scope
	// does not represent an SDK session or include background executions.
	private static readonly ROUTING_SCOPE = "vscode-foreground"
	private readonly executions = new RunCommandExecutionController()
	private readonly unregisterByHandle = new WeakMap<ForegroundCommandHandle, () => void>()
	private activeHandleCount = 0
	private nextExecutionId = 0

	constructor(private readonly options: SdkForegroundCommandCoordinatorOptions = {}) {}

	/** Whether any foreground command is currently awaited by a tool call. */
	get isRunning(): boolean {
		return this.activeHandleCount > 0
	}

	/**
	 * Track one in-flight foreground execution. Returns an unregister
	 * function the caller must invoke when the execution settles (completes,
	 * fails, aborts, or detaches) — typically from a `finally` block.
	 */
	register(handle: ForegroundCommandHandle): () => void {
		const wasRunning = this.isRunning
		if (!this.unregisterByHandle.has(handle)) {
			const unregister = this.executions.register({
				executionId: `foreground-${++this.nextExecutionId}`,
				sessionId: SdkForegroundCommandCoordinator.ROUTING_SCOPE,
				detach: () => {
					try {
						handle.detach()
						return true
					} catch (error) {
						Logger.error("[ForegroundCommands] Failed to detach foreground command:", error)
						return false
					}
				},
			})
			this.unregisterByHandle.set(handle, unregister)
			this.activeHandleCount++
		}
		// Registration, removal and the running flag change synchronously;
		// the caller owns removal when its waiting tool execution settles.
		this.notifyIfChanged(wasRunning)
		return () => {
			const wasRunningBefore = this.isRunning
			const unregister = this.unregisterByHandle.get(handle)
			if (unregister) {
				unregister()
				this.unregisterByHandle.delete(handle)
				this.activeHandleCount--
				this.notifyIfChanged(wasRunningBefore)
			}
		}
	}

	/**
	 * Detach every in-flight foreground command ("Proceed While Running").
	 * Each pending tool execution resolves with its partial output and log
	 * file path; the commands keep running in their terminals.
	 *
	 * @returns the number of detach attempts, including failed attempts.
	 */
	proceedWhileRunning(): number {
		const attemptedCount = this.activeHandleCount
		this.executions.proceedWhileRunning(SdkForegroundCommandCoordinator.ROUTING_SCOPE)
		return attemptedCount
	}

	private notifyIfChanged(wasRunning: boolean): void {
		if (this.isRunning !== wasRunning) {
			this.options.onRunningChanged?.(this.isRunning)
		}
	}
}
