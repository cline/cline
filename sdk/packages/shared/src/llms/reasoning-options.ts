import { z } from "zod";

export const REASONING_LEVELS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export const ReasoningLevelSchema = z.enum(REASONING_LEVELS);
export type ReasoningLevel = z.infer<typeof ReasoningLevelSchema>;

export const ReasoningEffortSchema = ReasoningLevelSchema.exclude(["none"]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

const ModelReasoningEffortValueSchema = z
	.enum([...REASONING_LEVELS, "default"])
	.nullable();

export const ModelReasoningOptionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("toggle") }).strict(),
	z
		.object({
			type: z.literal("effort"),
			values: z.array(ModelReasoningEffortValueSchema),
		})
		.strict(),
	z
		.object({
			type: z.literal("budget_tokens"),
			min: z.number().min(-1).optional(),
			max: z.number().min(0).optional(),
		})
		.strict()
		.refine(
			(option) =>
				option.min === undefined ||
				option.max === undefined ||
				option.min <= option.max,
			{
				message: "Minimum reasoning budget cannot exceed maximum",
				path: ["min"],
			},
		),
]);
export type ModelReasoningOption = z.infer<typeof ModelReasoningOptionSchema>;
