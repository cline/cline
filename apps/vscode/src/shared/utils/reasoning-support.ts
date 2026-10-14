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
	const adaptiveVersions = ["4-6", "4.6", "4-7", "4.7", "4-8", "4.8"]
	return (
		id.includes("claude-fable-5") ||
		adaptiveVersions.some((version) => id.includes(`claude-opus-${version}`) || id.includes(`claude-${version}-opus`))
	)
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
 * Map a legacy thinking-budget token count onto the reasoning-effort scale.
 *
 * The extension's reasoning control is effort-based (matching the CLI); the
 * SDK translates effort into provider wire formats, including budget-token
 * mapping where required. Budgets persisted by older versions (state fields
 * or migrated `reasoning.budgetTokens` in providers.json) are honored by
 * bucketing them onto the closest effort so extended thinking stays enabled
 * across the upgrade.
 */
export function reasoningEffortFromThinkingBudget(budgetTokens?: number): Exclude<OpenaiReasoningEffort, "none"> | undefined {
	if (typeof budgetTokens !== "number" || !Number.isFinite(budgetTokens) || budgetTokens <= 0) {
		return undefined
	}
	if (budgetTokens <= 2048) {
		return "low"
	}
	if (budgetTokens <= 8192) {
		return "medium"
	}
	return "high"
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
