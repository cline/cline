import { normalizeOpenaiReasoningEffort, type OpenaiReasoningEffort } from "../storage/types"

export interface ClaudeOpusAdaptiveThinkingSettings {
	enabled: boolean
	effort?: OpenaiReasoningEffort
}

export function isClaudeOpusAdaptiveThinkingModel(modelId?: string): boolean {
	if (!modelId) {
		return false
	}

	const id = modelId.toLowerCase()
	const adaptiveVersions = ["4-6", "4.6", "4-7", "4.7"]
	return adaptiveVersions.some((version) => id.includes(`claude-opus-${version}`) || id.includes(`claude-${version}-opus`))
}

export function resolveClaudeOpusAdaptiveThinking(
	reasoningEffort?: string,
	legacyThinkingBudgetTokens?: number,
): ClaudeOpusAdaptiveThinkingSettings {
	if (reasoningEffort) {
		const effort = normalizeOpenaiReasoningEffort(reasoningEffort)
		return effort === "none" ? { enabled: false } : { enabled: true, effort }
	}

	return legacyThinkingBudgetTokens && legacyThinkingBudgetTokens > 0 ? { enabled: true, effort: "high" } : { enabled: false }
}

/**
 * Resolves adaptive thinking settings for DeepSeek V4 models.
 *
 * DeepSeek V4 supports thinking mode: the model outputs a chain-of-thought
 * (reasoning_content) before the final answer to improve accuracy.
 *
 * Behavior:
 * 1. Default thinking is enabled.
 * 2. Default effort is "high" for standard requests; for complex agent-style
 *    requests (e.g., Claude Code, OpenCode), effort is automatically set to "max".
 * 3. For compatibility: "low" and "medium" are mapped to "high";
 *    "xhigh" is mapped to "max".
 */
export function resolveDeepSeekAdaptiveThinking(reasoningEffort?: string): ClaudeOpusAdaptiveThinkingSettings {
	if (reasoningEffort) {
		const effort = normalizeOpenaiReasoningEffort(reasoningEffort)
		return effort === "none" ? { enabled: false } : { enabled: true, effort }
	}
	// Default to high for DeepSeek V4
	return { enabled: true, effort: "high" }
}

export function supportsReasoningEffortForModel(modelId?: string): boolean {
	if (!modelId) {
		return false
	}

	const id = modelId.toLowerCase()
	return (
		id.includes("gemini") ||
		id.includes("gpt") ||
		id.startsWith("openai/o") ||
		id.includes("/o") ||
		id.startsWith("o") ||
		id.includes("grok")
	)
}
