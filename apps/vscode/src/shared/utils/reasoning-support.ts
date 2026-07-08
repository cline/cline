import { normalizeOpenaiReasoningEffort, type OpenaiReasoningEffort } from "../storage/types"

const ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS = 1024
const ANTHROPIC_MAX_THINKING_BUDGET_TOKENS = 128_000
const ANTHROPIC_REASONING_EFFORT_BUDGET_RATIOS: Partial<Record<OpenaiReasoningEffort, number>> = {
	low: 0.2,
	medium: 0.5,
	high: 0.8,
	xhigh: 1,
}

export interface ClaudeAdaptiveThinkingSettings {
	enabled: boolean
	effort?: OpenaiReasoningEffort
}

export type ClaudeOpusAdaptiveThinkingSettings = ClaudeAdaptiveThinkingSettings

export function isClaudeAdaptiveThinkingModel(modelId?: string): boolean {
	if (!modelId) {
		return false
	}

	const id = modelId.toLowerCase()
	const adaptiveVersions = ["4-6", "4.6", "4-7", "4.7", "4-8", "4.8"]
	return (
		id.includes("claude-fable-5") ||
		id.includes("claude-sonnet-5") ||
		id.includes("claude-5-sonnet") ||
		adaptiveVersions.some((version) => id.includes(`claude-opus-${version}`) || id.includes(`claude-${version}-opus`))
	)
}

export const isClaudeOpusAdaptiveThinkingModel = isClaudeAdaptiveThinkingModel

export function resolveClaudeAdaptiveThinking(
	reasoningEffort?: string,
	legacyThinkingBudgetTokens?: number,
): ClaudeAdaptiveThinkingSettings {
	if (reasoningEffort) {
		const effort = normalizeOpenaiReasoningEffort(reasoningEffort)
		return effort === "none" ? { enabled: false } : { enabled: true, effort }
	}

	return legacyThinkingBudgetTokens && legacyThinkingBudgetTokens > 0 ? { enabled: true, effort: "high" } : { enabled: false }
}

export const resolveClaudeOpusAdaptiveThinking = resolveClaudeAdaptiveThinking

export function resolveClaudeManualThinkingBudget(
	reasoningEffort?: string,
	legacyThinkingBudgetTokens?: number,
	maxTokens?: number,
	maxBudget?: number,
): number {
	if (reasoningEffort === undefined) {
		return legacyThinkingBudgetTokens || 0
	}

	const effort = normalizeOpenaiReasoningEffort(reasoningEffort)
	if (effort === "none") {
		return 0
	}

	const ratio = ANTHROPIC_REASONING_EFFORT_BUDGET_RATIOS[effort]
	if (!ratio) {
		return ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS
	}

	const maxBudgetForModel = Math.min(
		maxBudget ?? ANTHROPIC_MAX_THINKING_BUDGET_TOKENS,
		maxTokens && maxTokens > 1 ? maxTokens - 1 : ANTHROPIC_MAX_THINKING_BUDGET_TOKENS,
		ANTHROPIC_MAX_THINKING_BUDGET_TOKENS,
	)

	return Math.max(ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS, Math.floor(maxBudgetForModel * ratio))
}

export function supportsReasoningEffortForModel(modelId?: string): boolean {
	if (!modelId) {
		return false
	}

	const id = modelId.toLowerCase()
	return (
		id.includes("deepseek") ||
		id.includes("gemini") ||
		id.includes("glm") ||
		id.includes("gpt") ||
		id.includes("kimi") ||
		id.includes("mimo") ||
		id.includes("minimax") ||
		id.includes("moonshot") ||
		id.startsWith("openai/o") ||
		id.includes("/o") ||
		id.startsWith("o") ||
		id.includes("qwen") ||
		id.includes("z-ai") ||
		id.includes("zai") ||
		id.includes("grok")
	)
}
