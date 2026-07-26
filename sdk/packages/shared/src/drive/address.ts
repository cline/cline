/**
 * Drive address set — who the next send is scoped to.
 *
 * MVP shapes: everyone | explicit agent ids.
 * Pack mode is reserved so DRV-ROSTER-PACK can land without a schema rewrite.
 */

import { z } from "zod";

export const AddressEveryoneSchema = z
	.object({
		mode: z.literal("everyone"),
	})
	.strict();

export const AddressAgentsSchema = z
	.object({
		mode: z.literal("agents"),
		agentIds: z.array(z.string().min(1)).min(1),
	})
	.strict();

export const AddressPackSchema = z
	.object({
		mode: z.literal("pack"),
		packId: z.string().min(1),
	})
	.strict();

export const AddressSetSchema = z.discriminatedUnion("mode", [
	AddressEveryoneSchema,
	AddressAgentsSchema,
	AddressPackSchema,
]);

export type AddressEveryone = z.infer<typeof AddressEveryoneSchema>;
export type AddressAgents = z.infer<typeof AddressAgentsSchema>;
export type AddressPack = z.infer<typeof AddressPackSchema>;
export type AddressSet = z.infer<typeof AddressSetSchema>;

export const EVERYONE_ADDRESS: AddressEveryone = { mode: "everyone" };

export function parseAddressSet(input: unknown): AddressSet {
	return AddressSetSchema.parse(input);
}
