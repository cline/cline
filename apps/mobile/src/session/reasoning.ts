/** Reasoning settings supported by the Cloud session API. */
export const REASONING_CHOICES = [
	{ value: "none", label: "None" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "xhigh", label: "Extra" },
] as const;
export type ReasoningChoice = (typeof REASONING_CHOICES)[number]["value"];
export function isReasoningChoice(value: unknown): value is ReasoningChoice {
	return REASONING_CHOICES.some((choice) => choice.value === value);
}
export function reasoningUpdates(choice: ReasoningChoice) {
	return {
		thinking: choice !== "none",
		reasoningEffort: choice === "none" ? null : choice,
		thinkingBudgetTokens: null,
	};
}
export function reasoningFromMetadata(
	metadata?: Record<string, unknown>,
): ReasoningChoice | undefined {
	if (metadata?.thinking === false) return "none";
	if (metadata?.thinkingBudgetTokens != null) return undefined;
	return isReasoningChoice(metadata?.reasoningEffort)
		? metadata.reasoningEffort
		: undefined;
}
