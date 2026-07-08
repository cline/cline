import type { CoreSessionConfig } from "../../types/config";

export interface ConnectionUpdate {
	providerId?: string;
	modelId?: string;
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	providerConfig?: CoreSessionConfig["providerConfig"];
	reasoningEffort?: CoreSessionConfig["reasoningEffort"] | null;
	thinking?: CoreSessionConfig["thinking"] | null;
	thinkingBudgetTokens?: CoreSessionConfig["thinkingBudgetTokens"] | null;
}

export function normalizeConnectionUpdate(
	updates: ConnectionUpdate,
): ConnectionUpdate {
	const normalized: ConnectionUpdate = { ...updates };
	const hasThinking = Object.hasOwn(updates, "thinking");
	const hasThinkingBudgetTokens = Object.hasOwn(
		updates,
		"thinkingBudgetTokens",
	);
	const disablesThinking =
		updates.thinking === false || updates.thinking === null;

	if (disablesThinking) {
		normalized.reasoningEffort = undefined;
		normalized.thinkingBudgetTokens = undefined;
		return normalized;
	}

	if (
		!hasThinking &&
		hasThinkingBudgetTokens &&
		typeof updates.thinkingBudgetTokens === "number" &&
		Number.isFinite(updates.thinkingBudgetTokens) &&
		updates.thinkingBudgetTokens > 0
	) {
		normalized.thinking = true;
	}

	return normalized;
}
