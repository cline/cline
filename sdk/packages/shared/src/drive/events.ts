/**
 * Versioned DriveEvent union (DRV-EVENTS).
 *
 * Five tracks: control, conversation, work, presence, media (reserved — no
 * members yet). No event carries raw audio or full transcripts.
 */

import { z } from "zod";
import { AddressSetSchema } from "./address";
import {
	DRIVE_SCHEMA_VERSION,
	DriveSubModeSchema,
	ParticipantSchema,
	StageSharerSchema,
} from "./room";

export const DriveEventTrackSchema = z.enum([
	"control",
	"conversation",
	"work",
	"presence",
	"media",
]);
export type DriveEventTrack = z.infer<typeof DriveEventTrackSchema>;

const IsoTimestampSchema = z.preprocess(
	(value) => (value instanceof Date ? value.toISOString() : value),
	z.string().datetime(),
);

const DriveEventBaseSchema = z.object({
	schemaVersion: z.literal(DRIVE_SCHEMA_VERSION),
	id: z.string().min(1),
	roomId: z.string().min(1),
	at: IsoTimestampSchema,
	actorId: z.string().min(1).optional(),
});

// ── control ──────────────────────────────────────────────────────────────

export const ControlJoinEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.join"),
	track: z.literal("control"),
	participant: ParticipantSchema,
}).strict();

export const ControlLeaveEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.leave"),
	track: z.literal("control"),
	participantId: z.string().min(1),
	reason: z.string().optional(),
}).strict();

export const ControlMuteEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.mute"),
	track: z.literal("control"),
	participantId: z.string().min(1),
	muted: z.boolean(),
}).strict();

export const ControlStageEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.stage"),
	track: z.literal("control"),
	sharer: StageSharerSchema.nullable(),
}).strict();

export const ControlModeEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.mode"),
	track: z.literal("control"),
	subMode: DriveSubModeSchema,
	driveActive: z.boolean().optional(),
}).strict();

export const ControlRaiseHandEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.raise_hand"),
	track: z.literal("control"),
	participantId: z.string().min(1),
	raised: z.boolean(),
}).strict();

export const ControlAddressEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("control.address"),
	track: z.literal("control"),
	addressSet: AddressSetSchema,
}).strict();

// ── conversation ─────────────────────────────────────────────────────────

export const ConversationMessageEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("conversation.message"),
	track: z.literal("conversation"),
	text: z.string(),
	addressSet: AddressSetSchema.optional(),
}).strict();

export const ConversationNarrationEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("conversation.narration"),
	track: z.literal("conversation"),
	text: z.string().min(1),
	/** Work event this narration explains (DRV-NARRATION). */
	relatedWorkEventId: z.string().min(1).optional(),
}).strict();

// ── work ─────────────────────────────────────────────────────────────────

export const WorkEditEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("work.edit"),
	track: z.literal("work"),
	path: z.string().min(1),
	summary: z.string().optional(),
}).strict();

export const WorkCommandEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("work.command"),
	track: z.literal("work"),
	command: z.string().min(1),
	exitCode: z.number().int().optional(),
	failed: z.boolean().optional(),
}).strict();

export const WorkTestResultEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("work.test_result"),
	track: z.literal("work"),
	label: z.string().min(1),
	passed: z.boolean(),
	summary: z.string().optional(),
}).strict();

export const WorkPlanStepEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("work.plan_step"),
	track: z.literal("work"),
	title: z.string().min(1),
	status: z.enum(["pending", "in_progress", "done", "blocked"]),
	summary: z.string().optional(),
}).strict();

export const WorkDecisionEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("work.decision"),
	track: z.literal("work"),
	title: z.string().min(1),
	choice: z.string().min(1),
	summary: z.string().optional(),
}).strict();

// ── presence ─────────────────────────────────────────────────────────────

export const PresenceSpeakingEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("presence.speaking"),
	track: z.literal("presence"),
	participantId: z.string().min(1),
	speaking: z.boolean(),
}).strict();

export const PresenceTypingEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("presence.typing"),
	track: z.literal("presence"),
	participantId: z.string().min(1),
	typing: z.boolean(),
}).strict();

export const PresenceStatusEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("presence.status"),
	track: z.literal("presence"),
	participantId: z.string().min(1),
	status: z.enum(["idle", "working", "speaking", "away"]),
}).strict();

// Media track is reserved — no members in schemaVersion 1.

export const DriveEventSchema = z.discriminatedUnion("type", [
	ControlJoinEventSchema,
	ControlLeaveEventSchema,
	ControlMuteEventSchema,
	ControlStageEventSchema,
	ControlModeEventSchema,
	ControlRaiseHandEventSchema,
	ControlAddressEventSchema,
	ConversationMessageEventSchema,
	ConversationNarrationEventSchema,
	WorkEditEventSchema,
	WorkCommandEventSchema,
	WorkTestResultEventSchema,
	WorkPlanStepEventSchema,
	WorkDecisionEventSchema,
	PresenceSpeakingEventSchema,
	PresenceTypingEventSchema,
	PresenceStatusEventSchema,
]);

export type DriveEvent = z.infer<typeof DriveEventSchema>;
export type DriveEventType = DriveEvent["type"];

/** Forbidden payload keys — privacy gate for DRV-PRIVACY / DRV-EVENTS. */
export const DRIVE_EVENT_FORBIDDEN_KEYS = [
	"audio",
	"rawAudio",
	"pcm",
	"wav",
	"transcript",
	"fullTranscript",
	"rawTranscript",
	"speechAudio",
] as const;

export function parseDriveEvent(input: unknown): DriveEvent {
	return DriveEventSchema.parse(input);
}

/**
 * Exhaustive handler helper. Call sites that switch on `event.type` should
 * use a `never` default; this helper documents the closed set.
 */
export function assertNeverDriveEvent(event: never): never {
	throw new Error(
		`Unhandled DriveEvent: ${JSON.stringify(event satisfies never)}`,
	);
}
