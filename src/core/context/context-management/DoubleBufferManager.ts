/**
 * Double-buffer context management for Cline.
 *
 * Implements a two-phase compaction strategy:
 * - Checkpoint at ~60% capacity (background, high-quality summary)
 * - Swap at ~85% capacity (use pre-computed summary instead of stop-the-world)
 *
 * See: https://marklubin.me/posts/hopping-context-windows/
 */

import { ApiHandler } from "@core/api"
import { ClineMessage } from "@shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { getContextWindowInfo } from "./context-window-utils"

export type DoubleBufferPhase = "normal" | "checkpoint_pending" | "concurrent"

export interface DoubleBufferState {
	phase: DoubleBufferPhase
	checkpointSummary: string | null
	checkpointMessageIndex: number
	lastTokenCount: number
	generation: number
}

export class DoubleBufferManager {
	private state: DoubleBufferState = {
		phase: "normal",
		checkpointSummary: null,
		checkpointMessageIndex: 0,
		lastTokenCount: 0,
		generation: 0,
	}

	/** Checkpoint threshold as fraction of context window (default 0.60) */
	private checkpointThreshold: number

	/** Swap threshold as fraction of context window (default 0.85) */
	private swapThreshold: number

	constructor(checkpointThreshold = 0.6, swapThreshold = 0.85) {
		this.checkpointThreshold = checkpointThreshold
		this.swapThreshold = swapThreshold
	}

	getState(): Readonly<DoubleBufferState> {
		return { ...this.state }
	}

	/**
	 * Extract total token count from a ClineMessage at a given API request index.
	 */
	private extractTokenCount(clineMessages: ClineMessage[], apiReqIndex: number): number {
		if (apiReqIndex < 0) return 0
		const msg = clineMessages[apiReqIndex]
		if (!msg?.text) return 0
		try {
			const info = JSON.parse(msg.text)
			return (info.tokensIn || 0) + (info.tokensOut || 0) + (info.cacheWrites || 0) + (info.cacheReads || 0)
		} catch {
			return 0
		}
	}

	/**
	 * Check if a background checkpoint should be triggered.
	 * Returns true when in NORMAL phase and token usage exceeds checkpoint threshold.
	 */
	shouldCheckpoint(clineMessages: ClineMessage[], api: ApiHandler, previousApiReqIndex: number): boolean {
		if (this.state.phase !== "normal") return false

		const totalTokens = this.extractTokenCount(clineMessages, previousApiReqIndex)
		if (totalTokens === 0) return false

		this.state.lastTokenCount = totalTokens
		const { contextWindow } = getContextWindowInfo(api)
		const threshold = Math.floor(contextWindow * this.checkpointThreshold)

		if (totalTokens >= threshold) {
			Logger.info(
				`[DoubleBuffer] Checkpoint threshold reached: ${totalTokens} tokens >= ${threshold} (${(this.checkpointThreshold * 100).toFixed(0)}% of ${contextWindow})`,
			)
			return true
		}
		return false
	}

	/**
	 * Check if a buffer swap should be triggered.
	 * Returns true when in CONCURRENT phase (checkpoint ready) and token usage exceeds swap threshold.
	 */
	shouldSwap(clineMessages: ClineMessage[], api: ApiHandler, previousApiReqIndex: number): boolean {
		if (this.state.phase !== "concurrent") return false
		if (!this.state.checkpointSummary) return false

		const totalTokens = this.extractTokenCount(clineMessages, previousApiReqIndex)
		if (totalTokens === 0) return false

		this.state.lastTokenCount = totalTokens
		const { contextWindow } = getContextWindowInfo(api)
		const threshold = Math.floor(contextWindow * this.swapThreshold)

		if (totalTokens >= threshold) {
			Logger.info(
				`[DoubleBuffer] Swap threshold reached: ${totalTokens} tokens >= ${threshold} (${(this.swapThreshold * 100).toFixed(0)}% of ${contextWindow})`,
			)
			return true
		}
		return false
	}

	/**
	 * Begin the checkpoint phase. Records the current API conversation position.
	 */
	beginCheckpoint(apiConversationLength: number): void {
		this.state.phase = "checkpoint_pending"
		this.state.checkpointMessageIndex = apiConversationLength
		Logger.info(
			`[DoubleBuffer] Checkpoint started at message index ${apiConversationLength}, tokens: ${this.state.lastTokenCount}`,
		)
	}

	/**
	 * Complete the checkpoint with a summary. Transitions to concurrent phase.
	 */
	finishCheckpoint(summary: string): void {
		this.state.phase = "concurrent"
		this.state.checkpointSummary = summary
		this.state.generation++
		Logger.info(`[DoubleBuffer] Checkpoint complete, generation ${this.state.generation}, summary: ${summary.length} chars`)
	}

	/**
	 * Complete the buffer swap. Resets to normal phase for the next cycle.
	 * Returns the checkpoint summary that should be used as the compaction context.
	 */
	completeSwap(): string | null {
		const summary = this.state.checkpointSummary
		this.state.phase = "normal"
		this.state.checkpointSummary = null
		this.state.checkpointMessageIndex = 0
		Logger.info(`[DoubleBuffer] Swap complete, generation ${this.state.generation}`)
		return summary
	}

	/**
	 * Reset state (e.g., on task completion or error).
	 */
	reset(): void {
		this.state = {
			phase: "normal",
			checkpointSummary: null,
			checkpointMessageIndex: 0,
			lastTokenCount: 0,
			generation: 0,
		}
	}
}
