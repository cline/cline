/**
 * Drive room / roster / stage shapes (DRV-EVENTS).
 *
 * Parseable at hub and app boundaries. Live fields (addressSet, sharer)
 * are room state — not durable workspace facets.
 */

import { z } from "zod";
import { AddressSetSchema, EVERYONE_ADDRESS } from "./address";

export const DRIVE_SCHEMA_VERSION = 1 as const;

export const DriveSubModeSchema = z.enum(["plan", "act", "ask", "debug"]);
export type DriveSubMode = z.infer<typeof DriveSubModeSchema>;

export const DriveHumanRoleSchema = z.enum(["host", "participant", "observer"]);
export type DriveHumanRole = z.infer<typeof DriveHumanRoleSchema>;

export const DriveAgentRoleSchema = z.enum(["partner", "specialist", "recorder"]);
export type DriveAgentRole = z.infer<typeof DriveAgentRoleSchema>;

export const ParticipantStatusSchema = z.enum([
	"idle",
	"working",
	"speaking",
	"away",
]);
export type ParticipantStatus = z.infer<typeof ParticipantStatusSchema>;

export const HumanParticipantSchema = z
	.object({
		id: z.string().min(1),
		kind: z.literal("human"),
		displayName: z.string().min(1),
		role: DriveHumanRoleSchema,
		status: ParticipantStatusSchema.default("idle"),
	})
	.strict();

export const AgentParticipantSchema = z
	.object({
		id: z.string().min(1),
		kind: z.literal("agent"),
		displayName: z.string().min(1),
		role: DriveAgentRoleSchema,
		status: ParticipantStatusSchema.default("idle"),
		/** Roster-pack ids that seated this agent (DRV-ROSTER-PACK). */
		seatSources: z.array(z.string().min(1)).default([]),
	})
	.strict();

export const ParticipantSchema = z.discriminatedUnion("kind", [
	HumanParticipantSchema,
	AgentParticipantSchema,
]);
export type Participant = z.infer<typeof ParticipantSchema>;
export type HumanParticipant = z.infer<typeof HumanParticipantSchema>;
export type AgentParticipant = z.infer<typeof AgentParticipantSchema>;

export const StageSharerSchema = z
	.object({
		kind: z.enum(["human", "agent"]),
		participantId: z.string().min(1),
	})
	.strict();
export type StageSharer = z.infer<typeof StageSharerSchema>;

/** Structured human share pin (DRV-SHARE MVP). No WebRTC pixels. */
export const StagePinSchema = z
	.object({
		kind: z.enum(["selection", "file", "terminal"]),
		label: z.string().min(1),
		ref: z.string().min(1).optional(),
	})
	.strict();
export type StagePin = z.infer<typeof StagePinSchema>;

export const StageCardSchema = z
	.object({
		id: z.string().min(1),
		category: z.enum([
			"edit",
			"command",
			"test",
			"plan",
			"decision",
			"other",
		]),
		title: z.string().min(1),
		summary: z.string().optional(),
		workEventId: z.string().min(1).optional(),
		updatedAt: z.string().datetime(),
	})
	.strict();
export type StageCard = z.infer<typeof StageCardSchema>;

export const StageStateSchema = z
	.object({
		sharer: StageSharerSchema.nullable().default(null),
		pin: StagePinSchema.nullable().default(null),
		cards: z.array(StageCardSchema).default([]),
	})
	.strict();
export type StageState = z.infer<typeof StageStateSchema>;

export const RoomSnapshotSchema = z
	.object({
		schemaVersion: z.literal(DRIVE_SCHEMA_VERSION),
		roomId: z.string().min(1),
		createdAt: z.string().datetime(),
		driveActive: z.boolean(),
		subMode: DriveSubModeSchema,
		participants: z.array(ParticipantSchema),
		stage: StageStateSchema,
		addressSet: AddressSetSchema.default(EVERYONE_ADDRESS),
		muteByParticipantId: z.record(z.string(), z.boolean()).default({}),
		raisedHandByParticipantId: z
			.record(z.string(), z.boolean())
			.default({}),
		/** Ring of applied event ids for idempotent reduce. */
		appliedEventIds: z.array(z.string().min(1)).default([]),
	})
	.strict();
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;

export function parseRoomSnapshot(input: unknown): RoomSnapshot {
	return RoomSnapshotSchema.parse(input);
}

export function parseParticipant(input: unknown): Participant {
	return ParticipantSchema.parse(input);
}
