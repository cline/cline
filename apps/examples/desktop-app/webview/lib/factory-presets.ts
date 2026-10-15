import { factoryTaskConfigSchema } from "@cline/shared/browser";
import { z } from "zod";

export const factoryPresetConfigSchema = factoryTaskConfigSchema.pick({
	agents: true,
	maxRepairRounds: true,
	approval: true,
});
export const factoryPresetSchema = z.object({
	name: z.string().trim().min(1).max(100),
	// Bridge shared Zod 4 validation into the desktop's Zod 3 schema.
	config: z.unknown().transform((value, ctx) => {
		const result = factoryPresetConfigSchema.safeParse(value);
		if (result.success) return result.data;
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: result.error.message,
		});
		return z.NEVER;
	}),
});
export type FactoryPreset = z.infer<typeof factoryPresetSchema>;
