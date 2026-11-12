import {
	DEFAULT_FACTORY_AGENTS,
	type FactoryWorkflowConfig,
	factoryWorkflowConfigSchema,
} from "@cline/shared/browser";
import { z } from "zod";
import { FACTORY_CARD_COST_DEFAULT_USD } from "./factory-limits";

export const factoryPresetSchema = z.object({
	name: z.string().trim().min(1).max(100),
	revision: z
		.string()
		.regex(/^[a-f0-9]{64}$/)
		.optional(),
	// Bridge shared Zod 4 validation into the desktop's Zod 3 schema.
	config: z.unknown().transform((value, ctx) => {
		const result = factoryWorkflowConfigSchema.safeParse(value);
		if (result.success) return result.data;
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: result.error.message,
		});
		return z.NEVER;
	}),
});
export type FactoryPreset = z.infer<typeof factoryPresetSchema>;

/**
 * Built-in workflow: scope on submit, approve once plan review passes, and run
 * through verification and code review to a draft PR without manual steps.
 * It is the effective default only for a profile that has never saved a
 * workflow or chosen a default. Each card stops after $10, and review is
 * adaptive so the by-risk review policy (the hands-off default) knows each
 * change's impact; with fixed review every PR reads as "impact unknown" and
 * waits for the user.
 */
export const HANDS_OFF_PRESET_NAME = "Hands-off";
export const HANDS_OFF_PRESET_CONFIG: FactoryWorkflowConfig =
	factoryWorkflowConfigSchema.parse({
		autonomy: "hands_off",
		approval: "automatic",
		reviewMode: "adaptive",
		agents: DEFAULT_FACTORY_AGENTS,
		maxCostUsd: FACTORY_CARD_COST_DEFAULT_USD,
		maxRepairRounds: 2,
	});

export type FactoryPresetSettings = {
	factoryPresets?: FactoryPreset[];
	factoryDefaultPreset?: string;
};

export function factoryPresetTaskConfig(preset: FactoryPreset) {
	return {
		...structuredClone(preset.config),
		workflow: preset.revision
			? { name: preset.name, revision: preset.revision }
			: undefined,
	};
}

/** Equal normalized JSON is exactly what yields an equal workflow revision. */
export function factoryPresetMatches(
	preset: FactoryPreset,
	config: unknown,
): boolean {
	const current = factoryWorkflowConfigSchema.safeParse(config);
	return (
		current.success &&
		JSON.stringify(current.data) ===
			JSON.stringify(factoryWorkflowConfigSchema.parse(preset.config))
	);
}
