import type { CoreSessionConfig, ProviderSettings } from "@cline/core"
import { reasoningEffortFromThinkingBudget } from "@shared/utils/reasoning-support"

export type ReasoningEffort = NonNullable<CoreSessionConfig["reasoningEffort"]>
export type ProviderReasoningSettings = NonNullable<ProviderSettings["reasoning"]>
export type SessionReasoningConfig = Pick<CoreSessionConfig, "thinking" | "reasoningEffort">

/** The effort levels Cline's reasoning controls offer and persist. */
export type SupportedReasoningEffort = Extract<ReasoningEffort, "low" | "medium" | "high" | "xhigh">

export function isReasoningEffort(value: unknown): value is SupportedReasoningEffort {
	return value === "low" || value === "medium" || value === "high" || value === "xhigh"
}

/**
 * Convert SDK provider-level reasoning settings into the SDK session fields that
 * are actually forwarded as model options. Keep `thinking` and
 * `reasoningEffort` coherent: a disabled/none state must never carry an effort.
 *
 * A persisted `budgetTokens` without an effort (written by older extension
 * versions or the legacy-state migration) is honored by mapping the budget
 * onto the effort scale, so users who had extended thinking enabled keep it
 * enabled after upgrading to the effort-based control.
 */
export function normalizeProviderReasoningSettings(reasoning: ProviderReasoningSettings | undefined): SessionReasoningConfig {
	if (!reasoning) {
		return {}
	}

	if (reasoning.enabled === false || reasoning.effort === "none") {
		return { thinking: false }
	}

	const effort = isReasoningEffort(reasoning.effort)
		? reasoning.effort
		: reasoningEffortFromThinkingBudget(reasoning.budgetTokens)

	if (reasoning.enabled === true) {
		return {
			thinking: true,
			...(effort ? { reasoningEffort: effort } : {}),
		}
	}

	if (isReasoningEffort(reasoning.effort)) {
		return { reasoningEffort: reasoning.effort }
	}

	// Legacy budget with no explicit enabled/effort: treat as thinking-on.
	return effort ? { thinking: true, reasoningEffort: effort } : {}
}

/**
 * The SDK gateway's level for reasoning that is enabled without one (the CLI
 * saves `{ enabled: true }` for a bare `--thinking`).
 */
const ENABLED_WITHOUT_LEVEL_EFFORT: SupportedReasoningEffort = "medium"

/**
 * The effort level a session started now would request, for settings UIs to
 * display. `undefined` means nothing is saved and the provider or model
 * default applies, so a UI must not present it as any specific level; any
 * saved setting maps to a level, so the UI can always clear it.
 */
export function effectiveProviderReasoningEffort(
	reasoning: ProviderReasoningSettings | undefined,
): "none" | SupportedReasoningEffort | undefined {
	if (!reasoning) {
		return undefined
	}
	const normalized = normalizeProviderReasoningSettings(reasoning)
	if (normalized.thinking === false) {
		return "none"
	}
	if (isReasoningEffort(normalized.reasoningEffort)) {
		return normalized.reasoningEffort
	}
	return normalized.thinking === true ? ENABLED_WITHOUT_LEVEL_EFFORT : undefined
}
