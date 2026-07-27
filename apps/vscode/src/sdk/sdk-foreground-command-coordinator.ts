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
	private readonly handles = new Set<ForegroundCommandHandle>()

	constructor(private readonly options: SdkForegroundCommandCoordinatorOptions = {}) {}

	/** Whether any foreground command is currently awaited by a tool call. */
	get isRunning(): boolean {
		return this.handles.size > 0
	}

	/**
	 * Track one in-flight foreground execution. Returns an unregister
	 * function the caller must invoke when the execution settles (completes,
	 * fails, aborts, or detaches) — typically from a `finally` block.
	 */
	register(handle: ForegroundCommandHandle): () => void {
		const wasRunning = this.isRunning
		this.handles.add(handle)
		this.notifyIfChanged(wasRunning)
		return () => {
			const wasRunningBefore = this.isRunning
			if (this.handles.delete(handle)) {
				this.notifyIfChanged(wasRunningBefore)
			}
		}
	}

	/**
	 * Detach every in-flight foreground command ("Proceed While Running").
	 * Each pending tool execution resolves with its partial output and log
	 * file path; the commands keep running in their terminals.
	 *
	 * @returns the number of commands detached (0 when none were running).
	 */
	proceedWhileRunning(): number {
		const handles = [...this.handles]
		for (const handle of handles) {
			try {
				handle.detach()
			} catch (error) {
				Logger.error("[ForegroundCommands] Failed to detach foreground command:", error)
			}
		}
		return handles.length
	}

	private notifyIfChanged(wasRunning: boolean): void {
		if (this.isRunning !== wasRunning) {
			this.options.onRunningChanged?.(this.isRunning)
		}
	}
}
