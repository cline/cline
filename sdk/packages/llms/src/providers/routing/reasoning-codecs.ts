import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import {
	DEFAULT_GATEWAY_MAX_OUTPUT_TOKENS,
	isPositiveFiniteNumber,
} from "../gateway";

// OpenRouter separates total output limits (`max_tokens` / `max_output_tokens`)
// from `reasoning.max_tokens`, which caps only the reasoning-token portion.
// Sources:
// - https://openrouter.ai/docs/api/reference/parameters
// - https://openrouter.ai/docs/api/reference/responses/reasoning
const OPENROUTER_REASONING_BUDGET_FRACTION = 0.6;

export function hasReasoningControls(
	reasoning: GatewayStreamRequest["reasoning"],
): boolean {
	return (
		reasoning?.enabled !== undefined ||
		!!reasoning?.effort ||
		typeof reasoning?.budgetTokens === "number"
	);
}

function resolveOpenRouterReasoningMaxTokens(
	request: GatewayStreamRequest,
	context?: GatewayProviderContext,
): number {
	const outputMaxTokens = isPositiveFiniteNumber(request.maxTokens)
		? request.maxTokens
		: isPositiveFiniteNumber(context?.model.maxOutputTokens)
			? context.model.maxOutputTokens
			: DEFAULT_GATEWAY_MAX_OUTPUT_TOKENS;
	return Math.max(
		1,
		Math.floor(outputMaxTokens * OPENROUTER_REASONING_BUDGET_FRACTION),
	);
}

export function buildOpenRouterReasoningOptions(
	request: GatewayStreamRequest,
	context?: GatewayProviderContext,
): Record<string, unknown> | undefined {
	const reasoning = request.reasoning;
	if (!hasReasoningControls(reasoning)) {
		return undefined;
	}

	if (reasoning?.enabled === false) {
		return { effort: "none" };
	}

	// AI SDK `maxOutputTokens` still caps the whole response. This provider option
	// reserves room within that response by capping OpenRouter reasoning tokens.
	// Preserve explicit reasoning budgets when present; otherwise derive the cap
	// from the resolved request budget, model catalog output limit, or default.
	// OpenRouter rejects requests carrying both `reasoning.effort` and
	// `reasoning.max_tokens`, so the effort branch sends only `effort`.
	// DOCS: https://openrouter.ai/docs/api/reference/responses/reasoning
	if (typeof reasoning?.budgetTokens === "number") {
		return { max_tokens: reasoning.budgetTokens };
	}

	if (reasoning?.effort) {
		return { effort: reasoning.effort };
	}

	if (reasoning?.enabled === true) {
		return {
			enabled: true,
			max_tokens: resolveOpenRouterReasoningMaxTokens(request, context),
		};
	}

	return undefined;
}
