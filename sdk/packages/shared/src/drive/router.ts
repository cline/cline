import { z } from "zod";
import {
	AddressSetSchema,
	parseAddressSet,
	type AddressSet,
} from "./address";

export { AddressSetSchema, parseAddressSet, type AddressSet };

export const RouterModeSchema = z.enum(["manual", "suggest", "auto"]);
export type RouterMode = z.infer<typeof RouterModeSchema>;

export const RouteSliceSchema = z
	.object({
		sliceId: z.string().min(1),
		start: z.number().int().nonnegative(),
		end: z.number().int().nonnegative(),
		text: z.string(),
		addressSet: AddressSetSchema,
		score: z.number(),
		reasons: z.array(z.string()),
	})
	.strict()
	.superRefine((slice, ctx) => {
		if (slice.end < slice.start) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "RouteSlice.end must be >= start",
				path: ["end"],
			});
		}
	});
export type RouteSlice = z.infer<typeof RouteSliceSchema>;

export const RoutePlanSchema = z
	.object({
		utteranceId: z.string().min(1),
		mode: RouterModeSchema,
		slices: z.array(RouteSliceSchema).min(1),
		lowConfidence: z.boolean(),
	})
	.strict();
export type RoutePlan = z.infer<typeof RoutePlanSchema>;

export const SeatedAgentCardSchema = z
	.object({
		participantId: z.string().min(1),
		displayName: z.string().min(1),
		role: z.enum(["pair_partner", "specialist", "host", "other"]),
		labels: z.array(z.string()),
		domains: z.array(z.string()),
	})
	.strict();
export type SeatedAgentCard = z.infer<typeof SeatedAgentCardSchema>;

export function parseRoutePlan(input: unknown): RoutePlan {
	return RoutePlanSchema.parse(input);
}
