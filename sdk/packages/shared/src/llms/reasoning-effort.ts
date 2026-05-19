export const REASONING_EFFORT_RATIOS = {
	xhigh: 0.95,
	high: 0.8,
	medium: 0.5,
	low: 0.2,
	minimal: 0.1,
	none: 0,
} as const;

export type ReasoningEffortValue = keyof typeof REASONING_EFFORT_RATIOS;
export const DEFAULT_REASONING_EFFORT: ReasoningEffortValue | undefined =
	undefined;

export function resolveEffectiveReasoningEffort(
	reasoningEffort?: string,
	thinking?: boolean,
): ReasoningEffortValue | undefined {
	if (
		typeof reasoningEffort === "string" &&
		reasoningEffort.toLowerCase() in REASONING_EFFORT_RATIOS
	) {
		return reasoningEffort.toLowerCase() as ReasoningEffortValue;
	}

	return thinking ? DEFAULT_REASONING_EFFORT : undefined;
}

export function resolveReasoningEffortRatio(
	effort?: string,
	options?: { fallbackEffort?: ReasoningEffortValue },
): number | undefined {
	const normalizedEffort =
		typeof effort === "string" ? effort.toLowerCase() : undefined;

	if (normalizedEffort && normalizedEffort in REASONING_EFFORT_RATIOS) {
		return REASONING_EFFORT_RATIOS[normalizedEffort as ReasoningEffortValue];
	}

	if (options?.fallbackEffort) {
		return REASONING_EFFORT_RATIOS[options.fallbackEffort];
	}

	return undefined;
}

export function resolveReasoningBudgetFromRatio(options: {
	effort?: string;
	maxBudget: number;
	scaleTokens?: number;
	minimumBudget?: number;
	fallbackEffort?: ReasoningEffortValue;
}): number | undefined {
	const ratio = resolveReasoningEffortRatio(options.effort, {
		fallbackEffort: options.fallbackEffort,
	});
	if (ratio === undefined) {
		return undefined;
	}
	if (ratio <= 0) {
		return 0;
	}

	const minimumBudget = options.minimumBudget ?? 1;
	if (options.maxBudget < minimumBudget) {
		return undefined;
	}

	const scaleTokens = options.scaleTokens ?? options.maxBudget;
	return Math.min(
		Math.max(Math.floor(scaleTokens * ratio), minimumBudget),
		options.maxBudget,
	);
}
