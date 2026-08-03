// Prompt-Caching-friendly system prompt splitting (V14 §3.3)
//
// Anthropic/Bedrock prompt caching requires an EXACT prefix match between
// requests. The system prompt is rebuilt when switching Plan ⇄ Act (plan mode
// appends PLAN_MODE_INSTRUCTIONS and adds the `switch_to_act_mode` tool). If
// the whole prompt is sent with cache_control on the last block, a mode switch
// invalidates the entire cache → token cost doubles on long contexts.
//
// The fix: split the prompt into a mode-INDEPENDENT static prefix (base prompt
// + rules + MODE_TAG_INSTRUCTIONS) and a mode-DEPENDENT suffix (plan-mode
// contract). Attach cache_control to the prefix so the cached prefix survives
// mode switches. This module provides the pure split/measure helpers; the
// session config builder applies them.

import type { Mode } from "@shared/storage/types"

/** Marker that begins the plan-mode contract appended by buildClineSystemPrompt. */
export const PLAN_MODE_CONTRACT_MARKER = "# Plan Mode"

export interface SystemPromptSplit {
	/** Mode-independent prefix — safe to cache across mode switches. */
	prefix: string
	/** Mode-dependent suffix (empty for act mode). */
	suffix: string
	/** Fraction of the prompt covered by the prefix (0..1). */
	prefixRatio: number
}

/**
 * Split `prompt` at the FIRST occurrence of `marker`. The marker itself stays
 * in the suffix so the concatenation `prefix + suffix` is byte-identical to
 * the input.
 */
export function splitSystemPromptAtMarker(prompt: string, marker: string): SystemPromptSplit {
	const at = prompt.indexOf(marker)
	if (at < 0) {
		return { prefix: prompt, suffix: "", prefixRatio: prompt.length > 0 ? 1 : 0 }
	}
	const prefix = prompt.slice(0, at)
	const suffix = prompt.slice(at)
	const prefixRatio = prompt.length > 0 ? prefix.length / prompt.length : 0
	return { prefix, suffix, prefixRatio }
}

/**
 * Split a session system prompt the way the mode switch does: everything up to
 * the plan-mode contract is the cacheable prefix.
 */
export function splitModeSensitivePrompt(prompt: string, mode: Mode): SystemPromptSplit {
	if (mode === "plan") {
		return splitSystemPromptAtMarker(prompt, PLAN_MODE_CONTRACT_MARKER)
	}
	return { prefix: prompt, suffix: "", prefixRatio: prompt.length > 0 ? 1 : 0 }
}

/**
 * Length (in characters) of the longest common prefix of two strings.
 */
export function commonPrefixLength(a: string, b: string): number {
	const max = Math.min(a.length, b.length)
	let i = 0
	while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) {
		i++
	}
	return i
}

/**
 * Fraction (0..1) of the shorter prompt that is shared with the other one as a
 * common prefix. 1.0 means one prompt is a prefix of the other — the exact
 * situation prompt caching needs.
 */
export function measureSharedPrefixRatio(a: string, b: string): number {
	const shared = commonPrefixLength(a, b)
	const shorter = Math.min(a.length, b.length)
	return shorter > 0 ? shared / shorter : 0
}

/**
 * Names of tools present in `a` but missing from `b`. Used to quantify the
 * tool-list delta between plan and act mode (plan adds `switch_to_act_mode`).
 */
export function findToolDelta(a: ReadonlyArray<{ name: string }>, b: ReadonlyArray<{ name: string }>): string[] {
	const bNames = new Set(b.map((tool) => tool.name))
	return a.filter((tool) => !bNames.has(tool.name)).map((tool) => tool.name)
}
