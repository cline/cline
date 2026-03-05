import { Logger } from "@/shared/services/Logger"

const DEFAULT_CHAR_THRESHOLD = 15_000
const DEFAULT_TIME_THRESHOLD_MS = 60_000

/**
 * Detects in-generation text loops where a model produces excessive text
 * without ever emitting a tool call. Tracks both character count and elapsed
 * time since the last tool-related activity — aborts only when both thresholds
 * are exceeded to avoid false positives.
 */
export class InGenerationLoopDetector {
	private lastToolActivityTime: number
	private textLengthSinceLastTool = 0

	constructor(
		private readonly charThreshold = DEFAULT_CHAR_THRESHOLD,
		private readonly timeThresholdMs = DEFAULT_TIME_THRESHOLD_MS,
		private readonly now: () => number = Date.now,
	) {
		this.lastToolActivityTime = this.now()
	}

	onToolActivity(): void {
		this.lastToolActivityTime = this.now()
		this.textLengthSinceLastTool = 0
	}

	onTextChunk(chunkLength: number): void {
		this.textLengthSinceLastTool += chunkLength
	}

	isLooping(): boolean {
		const elapsed = this.now() - this.lastToolActivityTime
		if (this.textLengthSinceLastTool > this.charThreshold && elapsed > this.timeThresholdMs) {
			Logger.info(
				`[LoopDetection] Aborting stream: ${this.textLengthSinceLastTool} chars of text without tool activity in ${Math.round(elapsed / 1000)}s`,
			)
			return true
		}
		return false
	}
}
