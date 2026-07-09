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

export interface ConnectionUpdateInput {
	providerId?: string;
	modelId?: string;
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	providerConfig?: CoreSessionConfig["providerConfig"];
	thinking?: boolean;
	reasoningEffort?: CoreSessionConfig["reasoningEffort"];
	thinkingBudgetTokens?: number;
}

/**
 * Builds a ConnectionUpdate for switching a live session's provider/model
 * connection. Shared by clients (CLI, desktop sidecar, …) so the
 * thinking/reasoning transition rules stay consistent:
 * - `thinking: false` disables reasoning and clears effort/budget.
 * - `thinking: true` (or a provided effort/budget) enables reasoning; when no
 *   effort accompanies an explicit `thinking: true`, a stale effort from the
 *   previous connection is cleared rather than carried over.
 * - `thinking: undefined` leaves the session's reasoning state untouched.
 * Connection fields are included only when defined; an empty string is passed
 * through (it means "clear"), so callers that want to skip blanks must drop
 * them before calling.
 */
export function buildConnectionUpdate(
	input: ConnectionUpdateInput,
): ConnectionUpdate {
	const update: ConnectionUpdate = {};
	if (input.providerId !== undefined) update.providerId = input.providerId;
	if (input.modelId !== undefined) update.modelId = input.modelId;
	if (input.apiKey !== undefined) update.apiKey = input.apiKey;
	if (input.baseUrl !== undefined) update.baseUrl = input.baseUrl;
	if (input.headers !== undefined) update.headers = input.headers;
	if (input.providerConfig !== undefined) {
		update.providerConfig = input.providerConfig;
	}
	if (input.thinking === false) {
		update.thinking = false;
		update.reasoningEffort = null;
		update.thinkingBudgetTokens = null;
		return update;
	}
	if (input.thinking === true) {
		update.thinking = true;
		update.reasoningEffort = input.reasoningEffort ?? null;
	} else if (input.reasoningEffort !== undefined) {
		update.thinking = true;
		update.reasoningEffort = input.reasoningEffort;
	}
	if (
		typeof input.thinkingBudgetTokens === "number" &&
		Number.isFinite(input.thinkingBudgetTokens) &&
		input.thinkingBudgetTokens > 0
	) {
		update.thinking = true;
		update.thinkingBudgetTokens = Math.trunc(input.thinkingBudgetTokens);
	}
	return update;
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
