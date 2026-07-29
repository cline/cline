/**
 * Shared log envelope for room + bank families (ARD-0013 phase 6).
 * Keeps unions separate while one cursorable stream can carry both.
 */

import { z } from "zod";
import { BankDriveEventSchema } from "./bankEvents";
import { DriveEventSchema } from "./events";

export const DriveLogFamilySchema = z.enum(["room", "bank"]);
export type DriveLogFamily = z.infer<typeof DriveLogFamilySchema>;

export const DriveLogEnvelopeSchema = z.discriminatedUnion("family", [
	z
		.object({
			family: z.literal("room"),
			seq: z.number().int().positive(),
			roomId: z.string().min(1),
			event: DriveEventSchema,
		})
		.strict(),
	z
		.object({
			family: z.literal("bank"),
			seq: z.number().int().positive(),
			workspaceRoot: z.string().min(1).optional(),
			event: BankDriveEventSchema,
		})
		.strict(),
]);
export type DriveLogEnvelope = z.infer<typeof DriveLogEnvelopeSchema>;

export function parseDriveLogEnvelope(input: unknown): DriveLogEnvelope {
	return DriveLogEnvelopeSchema.parse(input);
}
