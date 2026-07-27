import {
	type ModelReasoningOption,
	REASONING_LEVELS,
	type ReasoningEffort,
} from "@cline/shared";

const ACTIVE_REASONING_EFFORTS = REASONING_LEVELS.filter(
	(level): level is ReasoningEffort => level !== "none",
);

interface ModelReasoningControls {
	effort?: Extract<ModelReasoningOption, { type: "effort" }>;
	budget?: Extract<ModelReasoningOption, { type: "budget_tokens" }>;
	toggle: boolean;
	efforts: ReasoningEffort[];
	supportsOff: boolean;
	supportsDefault: boolean;
}

export function getModelReasoningControls(
	options: readonly ModelReasoningOption[] | undefined,
): ModelReasoningControls | undefined {
	if (options === undefined) {
		return undefined;
	}

	const effort = options.find((option) => option.type === "effort");
	const budget = options.find((option) => option.type === "budget_tokens");
	const toggle = options.some((option) => option.type === "toggle");
	const advertised = new Set(effort?.values ?? []);
	return {
		effort,
		budget,
		toggle,
		efforts: ACTIVE_REASONING_EFFORTS.filter((value) => advertised.has(value)),
		supportsOff: toggle || advertised.has("none"),
		supportsDefault: advertised.has("default"),
	};
}

export function normalizeReasoningEffort(
	effort: ReasoningEffort,
	supportedEfforts: readonly ReasoningEffort[],
): ReasoningEffort | undefined {
	if (supportedEfforts.length === 0) {
		return undefined;
	}
	if (supportedEfforts.includes(effort)) {
		return effort;
	}

	const requestedIndex = ACTIVE_REASONING_EFFORTS.indexOf(effort);
	return supportedEfforts.reduce((nearest, candidate) => {
		const nearestDistance = Math.abs(
			ACTIVE_REASONING_EFFORTS.indexOf(nearest) - requestedIndex,
		);
		const candidateDistance = Math.abs(
			ACTIVE_REASONING_EFFORTS.indexOf(candidate) - requestedIndex,
		);
		// On a tie, preserve more capability.
		return candidateDistance <= nearestDistance ? candidate : nearest;
	});
}
