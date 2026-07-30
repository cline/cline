/**
 * RosterPack schemas (DRV-ROSTER-PACK).
 * Refs and appearance only — no prompts, tools, or model ids.
 */

import { z } from "zod";
import { InkRefSchema } from "./schemas";

/** Effective permission ceiling at seat time (DRV-ROSTER-PACK / home intents). */
export const PermissionPresetSchema = z.enum(["readonly", "standard", "full"]);
export type PermissionPreset = z.infer<typeof PermissionPresetSchema>;

export const RosterPackMemberRoleSchema = z.enum([
	"pair_partner",
	"specialist",
]);
export type RosterPackMemberRole = z.infer<typeof RosterPackMemberRoleSchema>;

export const RosterPackMemberOverrideSchema = z
	.object({
		displayName: z.string().min(1).optional(),
		nameInk: InkRefSchema.optional(),
		bodyInk: InkRefSchema.optional(),
	})
	.strict();
export type RosterPackMemberOverride = z.infer<
	typeof RosterPackMemberOverrideSchema
>;

export const RosterPackMemberSchema = z
	.object({
		profileId: z.string().min(1),
		role: RosterPackMemberRoleSchema,
		override: RosterPackMemberOverrideSchema.optional(),
	})
	.strict();
export type RosterPackMember = z.infer<typeof RosterPackMemberSchema>;

/**
 * Curated seating preset. Parse rejects prompt-shaped keys via .strict().
 */
export const RosterPackSchema = z
	.object({
		id: z.string().min(1),
		slug: z.string().min(1),
		displayName: z.string().min(1),
		description: z.string().optional(),
		members: z.array(RosterPackMemberSchema),
		addressable: z.boolean(),
	})
	.strict();
export type RosterPack = z.infer<typeof RosterPackSchema>;

export function parseRosterPack(input: unknown): RosterPack {
	return RosterPackSchema.parse(input);
}
