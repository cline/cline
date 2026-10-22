import {
	type GatewayProviderContext,
	type GatewayStreamRequest,
	isClineProvider,
	type ModelReasoningOption,
	resolveReasoningBudgetFromRatio,
} from "@cline/shared";
import {
	getModelReasoningControls,
	isClaudeFableModelId,
	normalizeReasoningEffort,
	providerReasoningRouteMatches,
} from "../model-facts";

function clampBudget(
	budgetTokens: number,
	option: Extract<ModelReasoningOption, { type: "budget_tokens" }>,
	maximum = Number.MAX_SAFE_INTEGER,
): number {
	if (budgetTokens === -1 && option.min === -1) {
		return -1;
	}

	const minimum = Math.max(option.min ?? 0, 0);
	const cappedMaximum = Math.min(
		option.max ?? Number.MAX_SAFE_INTEGER,
		maximum,
	);
	return Math.min(Math.max(Math.floor(budgetTokens), minimum), cappedMaximum);
}

/**
 * Normalize abstract reasoning intent against the provider/model controls
 * advertised by models.dev. Provider adapters remain responsible only for
 * translating the normalized request into their wire shape.
 */
export function normalizeReasoningRequest(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): GatewayStreamRequest {
	const reasoning = request.reasoning;
	if (!reasoning) {
		return request;
	}

	// Cline routes Claude through an OpenRouter-compatible backend. Vercel's
	// catalog advertises a toggle for Fable 5, but Fable reasoning is mandatory
	// and the backend rejects an explicit disable. Treat "off" as unsupported
	// and let the model keep its mandatory default.
	if (
		reasoning.enabled === false &&
		isClineProvider(request.providerId) &&
		isClaudeFableModelId(request.modelId)
	) {
		return { ...request, reasoning: undefined };
	}

	const options = context.model.reasoningOptions;
	if (options === undefined) {
		const modelId = request.modelId.toLowerCase();
		if (
			reasoning.enabled === false &&
			(isClaudeFableModelId(modelId) ||
				modelId.includes("stepfun/step-3.7-flash"))
		) {
			return { ...request, reasoning: undefined };
		}
		// Custom/unlisted models get only broadly supported effort values.
		const effort = reasoning.effort
			? reasoning.effort === "minimal"
				? "low"
				: reasoning.effort === "xhigh" || reasoning.effort === "max"
					? "high"
					: reasoning.effort
			: undefined;
		return {
			...request,
			reasoning: { ...reasoning, effort },
		};
	}

	// models.dev uses an explicitly empty list for reasoning models with no
	// advertised user-facing control.
	if (options.length === 0) {
		return { ...request, reasoning: undefined };
	}

	const controls = getModelReasoningControls(options);
	if (!controls) {
		return { ...request, reasoning: undefined };
	}

	if (reasoning.enabled === false) {
		return controls.supportsOff
			? { ...request, reasoning: { enabled: false } }
			: { ...request, reasoning: undefined };
	}

	const hasExplicitBudget = typeof reasoning.budgetTokens === "number";
	const effort = reasoning.effort
		? normalizeReasoningEffort(reasoning.effort, controls.efforts)
		: reasoning.enabled === true &&
				!hasExplicitBudget &&
				!controls.supportsDefault
			? normalizeReasoningEffort("medium", controls.efforts)
			: undefined;
	const isAnthropicBudget = providerReasoningRouteMatches(
		"anthropic-thinking",
		request,
		context,
	);
	const outputCap = request.maxTokens ?? context.model.maxOutputTokens;
	const maximumBudget = Math.min(
		controls.budget?.max ?? Number.MAX_SAFE_INTEGER,
		isAnthropicBudget && outputCap !== undefined
			? Math.max(outputCap - 1, 1)
			: Number.MAX_SAFE_INTEGER,
	);
	const explicitBudget =
		typeof reasoning.budgetTokens === "number" && controls.budget
			? clampBudget(reasoning.budgetTokens, controls.budget, maximumBudget)
			: undefined;

	if (effort) {
		return {
			...request,
			reasoning: {
				enabled: reasoning.effort ? reasoning.enabled : undefined,
				effort,
				budgetTokens: explicitBudget,
			},
		};
	}

	if (reasoning.enabled === true && !hasExplicitBudget && controls.effort) {
		return { ...request, reasoning: { enabled: true } };
	}

	if (controls.budget) {
		const scaleTokens =
			isAnthropicBudget && maximumBudget < Number.MAX_SAFE_INTEGER
				? maximumBudget
				: (outputCap ?? controls.budget.max);
		const derivedBudget =
			explicitBudget ??
			(reasoning.effort && scaleTokens !== undefined
				? resolveReasoningBudgetFromRatio({
						effort:
							isAnthropicBudget && reasoning.effort === "max"
								? "xhigh"
								: reasoning.effort,
						maxBudget: maximumBudget,
						scaleTokens,
						minimumBudget: Math.max(controls.budget.min ?? 1, 1),
					})
				: isAnthropicBudget && reasoning.enabled === true
					? Math.max(controls.budget.min ?? 1024, 1)
					: undefined);
		return derivedBudget !== undefined || reasoning.enabled === true
			? {
					...request,
					reasoning: {
						enabled: reasoning.enabled ?? true,
						budgetTokens: derivedBudget,
					},
				}
			: { ...request, reasoning: undefined };
	}

	if (controls.toggle) {
		return {
			...request,
			reasoning: {
				enabled:
					reasoning.enabled ??
					(reasoning.effort !== undefined ||
						reasoning.budgetTokens !== undefined),
			},
		};
	}

	if (controls.supportsDefault && reasoning.enabled === true) {
		return { ...request, reasoning: { enabled: true } };
	}

	return { ...request, reasoning: undefined };
}
