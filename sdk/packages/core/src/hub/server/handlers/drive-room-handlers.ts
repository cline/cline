/**
 * Hub call_* command handlers (DRV-ROOM-MVP + share-screen work bridge).
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
	workRecordFromToolEvent,
	type WorkRecordPayload,
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
		/** Optional agent session for tool → stage.cards bridge. */
		sessionId: z.string().min(1).optional(),
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

const WorkEditSchema = z
	.object({
		kind: z.literal("edit"),
		path: z.string().min(1),
		summary: z.string().optional(),
	})
	.strict();

const WorkCommandSchema = z
	.object({
		kind: z.literal("command"),
		command: z.string().min(1),
		failed: z.boolean().optional(),
		exitCode: z.number().int().optional(),
		summary: z.string().optional(),
	})
	.strict();

const WorkTestSchema = z
	.object({
		kind: z.literal("test_result"),
		label: z.string().min(1),
		passed: z.boolean(),
		summary: z.string().optional(),
	})
	.strict();

const CallRecordWorkPayloadSchema = z
	.object({
		roomId: z.string().min(1).optional(),
		sessionId: z.string().min(1).optional(),
		actorId: z.string().min(1).optional(),
		work: z.union([WorkEditSchema, WorkCommandSchema, WorkTestSchema]).optional(),
		tool: z
			.object({
				toolCallId: z.string().optional(),
				toolName: z.string().optional(),
				status: z.enum(["running", "completed", "failed"]).optional(),
				input: z.unknown().optional(),
				output: z.unknown().optional(),
				error: z.string().optional(),
				text: z.string().optional(),
			})
			.strict()
			.optional(),
	})
	.strict()
	.refine((value) => Boolean(value.roomId || value.sessionId), {
		message: "roomId or sessionId required",
	})
	.refine((value) => Boolean(value.work || value.tool), {
		message: "work or tool required",
	});

const CallGetRoomPayloadSchema = z
	.object({
		roomId: z.string().min(1).optional(),
		sessionId: z.string().min(1).optional(),
	})
	.strict()
	.refine((value) => Boolean(value.roomId || value.sessionId), {
		message: "roomId or sessionId required",
	});

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

function resolveRoomId(
	store: ReturnType<typeof getDriveRoomStore>,
	roomId: string | undefined,
	sessionId: string | undefined,
): string {
	if (roomId) {
		return roomId;
	}
	if (sessionId) {
		const linked = store.getRoomIdForSession(sessionId);
		if (linked) {
			return linked;
		}
		throw new Error(`room_not_found:session:${sessionId}`);
	}
	throw new Error("room_not_found:missing_id");
}

function resolveWorkPayload(payload: {
	work?: WorkRecordPayload;
	tool?: {
		toolCallId?: string;
		toolName?: string;
		status?: "running" | "completed" | "failed";
		input?: unknown;
		output?: unknown;
		error?: string;
		text?: string;
	};
}): WorkRecordPayload {
	if (payload.work) {
		return payload.work;
	}
	if (payload.tool) {
		const mapped = workRecordFromToolEvent(payload.tool);
		if (!mapped) {
			throw new Error("unsupported_tool_for_stage");
		}
		return mapped;
	}
	throw new Error("work_or_tool_required");
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
						sessionId: payload.sessionId,
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
							sessionId: payload.sessionId,
						},
						store,
					);
					publishRoomSnapshot(ctx, payload.roomId, result.snapshot);
				}
				if (payload.sessionId) {
					store.linkSession(payload.sessionId, payload.roomId);
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
			case "call_record_work": {
				const payload = CallRecordWorkPayloadSchema.parse(
					envelope.payload ?? {},
				);
				const roomId = resolveRoomId(
					store,
					payload.roomId,
					payload.sessionId,
				);
				const work = resolveWorkPayload(payload);
				const committed = store.recordWork({
					roomId,
					work,
					actorId: payload.actorId,
					eventId: payload.tool?.toolCallId
						? `work_${payload.tool.toolCallId}`
						: undefined,
				});
				publishRoomEvent(
					ctx,
					roomId,
					committed.snapshot,
					committed.event,
				);
				return okReply(envelope, snapshotPayload(committed.snapshot));
			}
			case "call_get_room": {
				const payload = CallGetRoomPayloadSchema.parse(
					envelope.payload ?? {},
				);
				const roomId = resolveRoomId(
					store,
					payload.roomId,
					payload.sessionId,
				);
				const snapshot = store.getOrThrow(roomId);
				return okReply(envelope, snapshotPayload(snapshot));
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
		if (message === "unsupported_tool_for_stage") {
			return errorReply(envelope, "unsupported_tool_for_stage", message);
		}
		const code = message.startsWith("room_not_found")
			? "room_not_found"
			: "call_command_failed";
		return errorReply(envelope, code, message);
	}
}
