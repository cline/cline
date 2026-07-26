/**
 * Hub call_* command handlers (DRV-ROOM-MVP).
 */

import type {
	HubCommandEnvelope,
	HubReplyEnvelope,
	Participant,
	RoomSnapshot,
	StageSharer,
} from "@cline/shared";
import { DriveSubModeSchema, ParticipantSchema, StageSharerSchema } from "@cline/shared";
import { z } from "zod";
import {
	type JoinCallResult,
	joinCall,
	getDriveRoomStore,
} from "../../collaboration";
import {
	type HubTransportContext,
	errorReply,
	okReply,
} from "./context";

const RoomIdSchema = z.object({
	roomId: z.string().min(1),
});

const CallJoinPayloadSchema = z
	.object({
		roomId: z.string().min(1),
		human: z
			.object({
				id: z.string().min(1),
				displayName: z.string().min(1),
				role: z.enum(["host", "participant", "observer"]).optional(),
			})
			.strict(),
		agent: z
			.object({
				id: z.string().min(1),
				displayName: z.string().min(1),
				role: z.enum(["partner", "specialist", "recorder"]).optional(),
			})
			.strict(),
		activateDrive: z.boolean().optional(),
		/** Optional raw participant join without joinCall façade. */
		participant: ParticipantSchema.optional(),
	})
	.strict();

const CallLeavePayloadSchema = RoomIdSchema.extend({
	participantId: z.string().min(1),
	reason: z.string().optional(),
}).strict();

const CallMutePayloadSchema = RoomIdSchema.extend({
	participantId: z.string().min(1),
	muted: z.boolean(),
}).strict();

const CallSetStagePayloadSchema = RoomIdSchema.extend({
	sharer: StageSharerSchema.nullable(),
	pin: z
		.object({
			kind: z.enum(["selection", "file", "terminal"]),
			label: z.string().min(1),
			ref: z.string().min(1).optional(),
		})
		.strict()
		.nullable()
		.optional(),
}).strict();

const CallSetModePayloadSchema = RoomIdSchema.extend({
	subMode: DriveSubModeSchema,
	driveActive: z.boolean().optional(),
}).strict();

function publishRoomEvent(
	ctx: HubTransportContext,
	roomId: string,
	snapshot: RoomSnapshot,
	event: unknown,
): void {
	ctx.publish(
		ctx.buildEvent("room.event", {
			roomId,
			snapshot,
			event,
		}),
	);
}

function publishRoomSnapshot(
	ctx: HubTransportContext,
	roomId: string,
	snapshot: RoomSnapshot,
): void {
	ctx.publish(
		ctx.buildEvent("room.snapshot", {
			roomId,
			snapshot,
		}),
	);
}

function snapshotPayload(snapshot: RoomSnapshot): Record<string, unknown> {
	return { roomId: snapshot.roomId, snapshot };
}

export function handleDriveRoomCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const store = getDriveRoomStore();
	try {
		switch (envelope.command) {
			case "call_join": {
				const payload = CallJoinPayloadSchema.parse(envelope.payload ?? {});
				let result: JoinCallResult | { snapshot: RoomSnapshot };
				if (payload.participant) {
					store.create(payload.roomId);
					const committed = store.join({
						roomId: payload.roomId,
						participant: payload.participant as Participant,
					});
					result = { snapshot: committed.snapshot };
					publishRoomEvent(
						ctx,
						payload.roomId,
						committed.snapshot,
						committed.event,
					);
				} else {
					result = joinCall(
						{
							roomId: payload.roomId,
							human: payload.human,
							agent: payload.agent,
							activateDrive: payload.activateDrive,
						},
						store,
					);
					publishRoomSnapshot(ctx, payload.roomId, result.snapshot);
				}
				return okReply(envelope, snapshotPayload(result.snapshot));
			}
			case "call_leave": {
				const payload = CallLeavePayloadSchema.parse(envelope.payload ?? {});
				const committed = store.leave(payload);
				publishRoomEvent(
					ctx,
					payload.roomId,
					committed.snapshot,
					committed.event,
				);
				return okReply(envelope, snapshotPayload(committed.snapshot));
			}
			case "call_mute": {
				const payload = CallMutePayloadSchema.parse(envelope.payload ?? {});
				const committed = store.mute(payload);
				publishRoomEvent(
					ctx,
					payload.roomId,
					committed.snapshot,
					committed.event,
				);
				return okReply(envelope, snapshotPayload(committed.snapshot));
			}
			case "call_set_stage": {
				const payload = CallSetStagePayloadSchema.parse(
					envelope.payload ?? {},
				);
				const committed = store.setStage({
					roomId: payload.roomId,
					sharer: payload.sharer as StageSharer | null,
					pin: payload.pin,
				});
				publishRoomEvent(
					ctx,
					payload.roomId,
					committed.snapshot,
					committed.event,
				);
				return okReply(envelope, snapshotPayload(committed.snapshot));
			}
			case "call_set_mode": {
				const payload = CallSetModePayloadSchema.parse(
					envelope.payload ?? {},
				);
				const committed = store.setMode(payload);
				publishRoomEvent(
					ctx,
					payload.roomId,
					committed.snapshot,
					committed.event,
				);
				return okReply(envelope, snapshotPayload(committed.snapshot));
			}
			default:
				return errorReply(
					envelope,
					"unsupported_call_command",
					`unsupported call command: ${envelope.command}`,
				);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const code = message.startsWith("room_not_found:")
			? "room_not_found"
			: "call_command_failed";
		return errorReply(envelope, code, message);
	}
}
