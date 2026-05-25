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
