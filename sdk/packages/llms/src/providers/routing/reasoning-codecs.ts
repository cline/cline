import type { GatewayStreamRequest } from "@cline/shared";

export function hasReasoningControls(
	reasoning: GatewayStreamRequest["reasoning"],
): boolean {
	return (
		reasoning?.enabled !== undefined ||
		!!reasoning?.effort ||
		typeof reasoning?.budgetTokens === "number"
	);
}

export function buildOpenRouterReasoningOptions(
	request: GatewayStreamRequest,
): Record<string, unknown> | undefined {
	const reasoning = request.reasoning;
	if (!hasReasoningControls(reasoning)) {
		return undefined;
	}

	if (reasoning?.enabled === false) {
		return { exclude: true };
	}

	// OpenRouter accepts one reasoning control mode. Preserve this precedence:
	// explicit disable, exact token budget, effort level, then plain enable.
	if (typeof reasoning?.budgetTokens === "number") {
		return { max_tokens: reasoning.budgetTokens };
	}

	if (reasoning?.effort) {
		return { effort: reasoning.effort };
	}

	if (reasoning?.enabled === true) {
		return { enabled: true };
	}

	return undefined;
}
