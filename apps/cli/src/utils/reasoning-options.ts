import {
	type ModelReasoningOption,
	REASONING_LEVELS,
	type ReasoningEffort,
} from "@cline/shared";

export type ReasoningChoice =
	| "default"
	| "enabled"
	| (typeof REASONING_LEVELS)[number];

export interface ReasoningChoiceOption {
	value: ReasoningChoice;
	label: string;
	desc: string;
}

export interface ReasoningModel {
	supportsReasoning?: boolean;
	reasoningOptions?: readonly ModelReasoningOption[];
}

const OPTIONS: Record<ReasoningChoice, ReasoningChoiceOption> = {
	default: {
		value: "default",
		label: "Provider default",
		desc: "Let the provider choose",
	},
	enabled: { value: "enabled", label: "On", desc: "Enable reasoning" },
	none: { value: "none", label: "Off", desc: "Disable reasoning" },
	minimal: { value: "minimal", label: "Minimal", desc: "Least reasoning" },
	low: { value: "low", label: "Low", desc: "Light reasoning" },
	medium: { value: "medium", label: "Medium", desc: "Balanced reasoning" },
	high: { value: "high", label: "High", desc: "Deep reasoning" },
	xhigh: {
		value: "xhigh",
		label: "Extra high",
		desc: "More extensive reasoning",
	},
	max: { value: "max", label: "Max", desc: "Maximum reasoning" },
};

/** Use catalog controls when available; custom servers may only supply model IDs. */
export function getReasoningChoices(
	model?: ReasoningModel,
	options?: { allowUnknown?: boolean },
): ReasoningChoiceOption[] {
	const controls = model?.reasoningOptions;
	const choices = new Set<ReasoningChoice>(["default"]);
	if (controls === undefined) {
		if (model?.supportsReasoning || options?.allowUnknown) {
			for (const level of REASONING_LEVELS) choices.add(level);
		}
	} else {
		const effort = controls.find((control) => control.type === "effort");
		const toggle = controls.some((control) => control.type === "toggle");
		const budget = controls.some((control) => control.type === "budget_tokens");
		if (toggle || effort?.values.includes("none")) choices.add("none");
		for (const level of REASONING_LEVELS) {
			if (level !== "none" && effort?.values.includes(level))
				choices.add(level);
		}
		// Budget-only models use the SDK's existing effort-to-budget mapping.
		if (!effort && budget) {
			for (const level of ["low", "medium", "high", "xhigh", "max"] as const)
				choices.add(level);
		} else if (toggle && choices.size === 2) {
			choices.add("enabled");
		}
	}
	return [...choices].map((choice) => OPTIONS[choice]);
}

export interface CliReasoningSelection {
	thinking?: boolean;
	reasoningEffort?: ReasoningEffort;
	thinkingBudgetTokens?: number;
	/** An explicit reset, distinct from leaving existing reasoning untouched. */
	reasoningDefault?: boolean;
}

export function getCurrentReasoningChoice(
	config: CliReasoningSelection,
): ReasoningChoice {
	if (config.reasoningDefault) return "default";
	if (config.thinking === false) return "none";
	return (
		config.reasoningEffort ?? (config.thinking === true ? "enabled" : "default")
	);
}

export function applyReasoningChoice(
	config: CliReasoningSelection,
	choice: ReasoningChoice,
): void {
	config.reasoningDefault = choice === "default";
	config.thinking = choice === "default" ? undefined : choice !== "none";
	config.reasoningEffort =
		choice === "default" || choice === "none" || choice === "enabled"
			? undefined
			: choice;
	config.thinkingBudgetTokens = undefined;
}
