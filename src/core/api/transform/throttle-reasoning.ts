import { ApiStream } from "./stream"

/**
 * Configuration for reasoning stream throttling
 */
interface ThrottleConfig {
	/**
	 * Interval in milliseconds to release buffered reasoning chunks
	 * Default: 75ms (provides smooth, readable streaming)
	 */
	intervalMs?: number
	/**
	 * Maximum characters per chunk
	 * Default: 8 (smaller chunks for better readability)
	 */
	maxChars?: number
}

const DEFAULT_CONFIG: Required<ThrottleConfig> = {
	intervalMs: 75, // Slower release - 75ms between chunks
	maxChars: 8, // Smaller chunks for better readability
}

/**
 * Throttles reasoning chunks in an API stream to provide consistent streaming experience
 * across different providers (Anthropic sends tiny deltas, Gemini sends larger chunks).
 *
 * How it works:
 * - Buffers reasoning text chunks
 * - Releases buffered content at consistent intervals (default 50ms)
 * - Enforces minimum/maximum buffer sizes to balance smoothness vs latency
 * - Passes through non-reasoning chunks immediately
 * - Flushes remaining buffer when stream ends
 *
 * @param source The source API stream to throttle
 * @param config Optional throttling configuration
 * @returns A new API stream with throttled reasoning chunks
 */
export async function* throttleReasoningStream(source: ApiStream, config: ThrottleConfig = {}): ApiStream {
	const { intervalMs, maxChars } = { ...DEFAULT_CONFIG, ...config }

	for await (const chunk of source) {
		// Pass through non-reasoning chunks immediately
		if (chunk.type !== "reasoning") {
			yield chunk
			continue
		}

		// Split reasoning into small chunks and release them gradually
		const reasoning = chunk.reasoning
		let position = 0

		while (position < reasoning.length) {
			// Take a small slice of reasoning
			const sliceSize = Math.min(maxChars, reasoning.length - position)
			const reasoningSlice = reasoning.slice(position, position + sliceSize)
			position += sliceSize

			// Yield the small chunk
			yield {
				...chunk,
				reasoning: reasoningSlice,
			}

			// Wait before releasing next chunk (but not after the last chunk)
			if (position < reasoning.length) {
				await new Promise((resolve) => setTimeout(resolve, intervalMs))
			}
		}
	}
}
