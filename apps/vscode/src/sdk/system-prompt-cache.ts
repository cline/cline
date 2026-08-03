// V16 §2 — Prompt-caching system prompt tracker (wires V14 §3.3 pure helpers in).
//
// Anthropic/Bedrock prompt caching needs an EXACT byte-for-byte prefix across
// requests. The system prompt is rebuilt on every session (re)start and when
// switching Plan ⇄ Act. If any byte before the cache boundary changes, the
// whole prefix is re-written and the cache misses.
//
// This tracker sits at the single point where the session config builder
// produces the final system prompt (cline-session-factory). It:
//   1. remembers the last-built prompt (per mode) and tool set,
//   2. measures the shared prefix between successive builds and flags
//      "cache-busting" regressions (a prefix that changed),
//   3. exposes estimateCacheHitRate() so the metric can be logged/observed,
//   4. keeps the split point (splitModeSensitivePrompt) honest: the
//      mode-independent prefix must stay byte-identical across mode switches.
//
// The extension cannot set Cache-Control itself — the SDK core does that from
// the SDK model catalog — but a stable prefix is the precondition for those
// headers to hit. Logging stability violations turns an invisible cost
// regression into an actionable warning.

import { Logger } from "@shared/services/Logger"
import type { Mode } from "@shared/storage/types"
import { commonPrefixLength, findToolDelta, measureSharedPrefixRatio, splitModeSensitivePrompt } from "./system-prompt-prefix"

export interface SystemPromptCacheMetrics {
	/** Mode of the previously tracked prompt, if any. */
	previousMode?: Mode
	/** Current mode. */
	mode: Mode
	/** Bytes of the common prefix between previous and current prompt. */
	sharedPrefixChars: number
	/** Fraction (0..1) of the shorter prompt that is shared as a prefix. */
	sharedPrefixRatio: number
	/**
	 * Length of the current prompt's mode-independent prefix (everything before
	 * the plan-mode contract marker). Byte-identical across modes is what lets
	 * the cache survive Plan ⇄ Act switches.
	 */
	modeIndependentPrefixChars: number
	/** Tool names present in the current set but missing from the previous one. */
	toolDelta: string[]
	/** True when the shared prefix shrank enough to invalidate a provider cache. */
	cacheBusting: boolean
}

export interface SystemPromptCacheSnapshot {
	metrics: SystemPromptCacheMetrics[]
	/** Number of builds tracked so far. */
	buildCount: number
}

/**
 * Extracts the shared static prefix of a mode's prompt (V14 naming):
 * everything up to the plan-mode contract marker is the cacheable prefix.
 */
export function extractSharedPrefix(prompt: string, mode: Mode): string {
	return splitModeSensitivePrompt(prompt, mode).prefix
}

export class SystemPromptCacheTracker {
	private lastMode: Mode | undefined
	private lastPrompt: string | undefined
	private lastTools: ReadonlyArray<{ name: string }> | undefined
	private readonly metrics: SystemPromptCacheMetrics[] = []

	/**
	 * Record a freshly built system prompt. Returns the stability metrics for
	 * this build. When a cache-busting regression is detected it is logged via
	 * Logger.warn so it is visible without any extra instrumentation.
	 */
	track(prompt: string, mode: Mode, tools?: ReadonlyArray<{ name: string }>): SystemPromptCacheMetrics {
		const previousMode = this.lastMode
		const previousPrompt = this.lastPrompt
		let sharedPrefixChars = 0
		let sharedPrefixRatio = 0
		if (previousPrompt !== undefined) {
			sharedPrefixChars = commonPrefixLength(previousPrompt, prompt)
			sharedPrefixRatio = measureSharedPrefixRatio(previousPrompt, prompt)
		}

		const toolDelta =
			previousMode !== undefined && previousMode !== mode && this.lastTools && tools
				? findToolDelta(tools, this.lastTools)
				: []

		const modeIndependentPrefixChars = splitModeSensitivePrompt(prompt, mode).prefix.length
		// A prefix that is not a strict prefix of the new prompt means the bytes
		// providers cache changed → the cache boundary moved → miss.
		const cacheBusting = previousPrompt !== undefined && sharedPrefixRatio < 0.99

		const entry: SystemPromptCacheMetrics = {
			previousMode,
			mode,
			sharedPrefixChars,
			sharedPrefixRatio,
			modeIndependentPrefixChars,
			toolDelta,
			cacheBusting,
		}
		this.metrics.push(entry)

		this.lastMode = mode
		this.lastPrompt = prompt
		if (tools) {
			this.lastTools = tools
		}

		if (cacheBusting) {
			Logger.warn(
				`[SystemPromptCache] Cache-busting system prompt rebuild: ` +
					`mode ${previousMode}→${mode}, shared prefix ratio ${sharedPrefixRatio.toFixed(4)} ` +
					`(${sharedPrefixChars} chars). Move mode-dependent content after the "${"# Plan Mode"}" marker.`,
			)
		}
		return entry
	}

	/**
	 * The tool-set delta between two modes (V14 naming) — computed from the
	 * last two tracked tool sets across a mode switch.
	 */
	computeModeDelta(previous: ReadonlyArray<{ name: string }>, current: ReadonlyArray<{ name: string }>): string[] {
		return findToolDelta(current, previous)
	}

	/**
	 * Rolling estimate of the prompt-cache hit rate (0..1): the mean shared
	 * prefix ratio over all tracked rebuilds. 1.0 means every rebuild reused
	 * the previous prompt's prefix unchanged.
	 */
	estimateCacheHitRate(): number {
		if (this.metrics.length === 0) {
			return 1
		}
		let sum = 0
		let weighted = 0
		for (const entry of this.metrics) {
			// First build has no predecessor — treat as a full hit baseline.
			const ratio = entry.previousMode === undefined ? 1 : entry.sharedPrefixRatio
			sum += ratio
			weighted += 1
		}
		return sum / weighted
	}

	get snapshot(): SystemPromptCacheSnapshot {
		return { metrics: [...this.metrics], buildCount: this.metrics.length }
	}

	reset(): void {
		this.lastMode = undefined
		this.lastPrompt = undefined
		this.lastTools = undefined
		this.metrics.length = 0
	}
}

/** Process-wide tracker shared by every session the factory builds. */
export const systemPromptCacheTracker = new SystemPromptCacheTracker()
