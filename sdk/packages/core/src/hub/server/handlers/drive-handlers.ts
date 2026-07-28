import {
	setParticipantDeafened,
	setParticipantMuted,
	setSpotlight,
} from "@cline/drive";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	createEmptyDriveRoomLiveState,
	type DriveRoomLiveState,
	type ShowBacklogItem,
	ShowBacklogItemSchema,
} from "@cline/shared";
import { produceMermaidShowArtifact } from "../../drive-producers/produceMermaid";
import { errorReply, type HubTransportContext, okReply } from "./context";

const rooms = new Map<string, DriveRoomLiveState>();

function getOrCreateRoom(roomId: string): DriveRoomLiveState {
	const existing = rooms.get(roomId);
	if (existing) {
		return existing;
	}
	const created = createEmptyDriveRoomLiveState(roomId);
	rooms.set(roomId, created);
	return created;
}

function bump(room: DriveRoomLiveState): DriveRoomLiveState {
	const next = { ...room, version: room.version + 1 };
	rooms.set(room.roomId, next);
	return next;
}

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(
	payload: Record<string, unknown> | undefined,
	key: string,
): boolean | undefined {
	const value = payload?.[key];
	return typeof value === "boolean" ? value : undefined;
}

function publishRoom(
	ctx: HubTransportContext,
	room: DriveRoomLiveState,
	extraEvent?: {
		event: "drive.spotlight.changed" | "drive.show.presented";
		payload: Record<string, unknown>;
	},
): void {
	ctx.publish(
		ctx.buildEvent("drive.room.changed", {
			room: room as unknown as Record<string, unknown>,
		}),
	);
	if (extraEvent) {
		ctx.publish(ctx.buildEvent(extraEvent.event, extraEvent.payload));
	}
}

/**
 * Materialize show artifacts that still need production (e.g. mermaid → SVG data URI).
 * Keeps caller id/title/caption; fills uri when produce.tool is render_mermaid.
 */
export function materializeShowItem(
	showItem: ShowBacklogItem,
): ShowBacklogItem {
	if (showItem.uri || showItem.produce.tool !== "render_mermaid") {
		return showItem;
	}
	const mermaidSource = showItem.produce.args.mermaidSource;
	if (typeof mermaidSource !== "string" || !mermaidSource.trim()) {
		return showItem;
	}
	const produced = produceMermaidShowArtifact({
		mermaidSource,
		ownerParticipantId: showItem.ownerParticipantId,
		title: showItem.title,
		caption: showItem.caption,
		templateId: showItem.produce.templateId,
	});
	return {
		...showItem,
		uri: produced.item.uri,
		status: "ready",
		scoreReasons: [
			...new Set([...showItem.scoreReasons, ...produced.item.scoreReasons]),
		],
	};
}

export function handleDriveCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	switch (envelope.command) {
		case "drive.room.get":
			return handleRoomGet(envelope);
		case "drive.spotlight.set":
			return handleSpotlightSet(ctx, envelope);
		case "drive.participant.mute.set":
			return handleMuteSet(ctx, envelope);
		case "drive.participant.deafen.set":
			return handleDeafenSet(ctx, envelope);
		case "drive.show.present":
			return handleShowPresent(ctx, envelope);
		default:
			return errorReply(envelope, "not_implemented", "Unknown drive command");
	}
}

function handleRoomGet(envelope: HubCommandEnvelope): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const room = getOrCreateRoom(roomId);
	return okReply(envelope, { room });
}

function handleSpotlightSet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const participantId = readString(envelope.payload, "participantId");
	const reason = readString(envelope.payload, "reason") ?? "human";
	if (!participantId) {
		return errorReply(envelope, "invalid_payload", "participantId is required");
	}
	const room = getOrCreateRoom(roomId);
	const seated = new Set(room.seatedParticipantIds);
	if (seated.size === 0) {
		seated.add(participantId);
	}
	const result = setSpotlight({ participantId, seatedIds: seated });
	if (!result.ok) {
		return errorReply(envelope, result.code, result.message);
	}
	const from = room.spotlightParticipantId;
	const next = bump({
		...room,
		spotlightParticipantId: result.spotlightParticipantId,
		seatedParticipantIds: [...seated],
		director: {
			...room.director,
			spotlightParticipantId: result.spotlightParticipantId,
		},
	});
	publishRoom(ctx, next, {
		event: "drive.spotlight.changed",
		payload: { from, to: result.spotlightParticipantId, reason },
	});
	return okReply(envelope, { room: next });
}

function handleMuteSet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	return handleAudioFlag(ctx, envelope, "muted");
}

function handleDeafenSet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	return handleAudioFlag(ctx, envelope, "deafened");
}

function handleAudioFlag(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	flag: "muted" | "deafened",
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const participantId = readString(envelope.payload, "participantId");
	const value = readBoolean(envelope.payload, flag);
	if (!participantId || value === undefined) {
		return errorReply(
			envelope,
			"invalid_payload",
			`participantId and ${flag} are required`,
		);
	}
	const room = getOrCreateRoom(roomId);
	const participantAudio =
		flag === "muted"
			? setParticipantMuted(room.participantAudio, participantId, value)
			: setParticipantDeafened(room.participantAudio, participantId, value);
	const next = bump({ ...room, participantAudio });
	publishRoom(ctx, next);
	return okReply(envelope, { room: next });
}

function handleShowPresent(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const parsedShow = ShowBacklogItemSchema.safeParse(
		envelope.payload?.showItem,
	);
	if (!parsedShow.success) {
		return errorReply(
			envelope,
			"invalid_payload",
			"showItem must be a valid ShowBacklogItem",
		);
	}
	const showItem = materializeShowItem(parsedShow.data);
	const room = getOrCreateRoom(roomId);
	const showBacklog = [
		showItem,
		...room.director.showBacklog.filter((item) => item.id !== showItem.id),
	];
	const next = bump({
		...room,
		director: {
			...room.director,
			showBacklog,
			activeShowId: showItem.id,
			stickyShowIds: [showItem.id, ...room.director.stickyShowIds].filter(
				(id, index, all) => all.indexOf(id) === index,
			),
			lastPresentedAt: new Date().toISOString(),
			spotlightParticipantId:
				room.spotlightParticipantId ?? showItem.ownerParticipantId,
		},
		spotlightParticipantId:
			room.spotlightParticipantId ?? showItem.ownerParticipantId,
	});
	publishRoom(ctx, next, {
		event: "drive.show.presented",
		payload: {
			showItemId: showItem.id,
			ownerParticipantId: showItem.ownerParticipantId,
			uri: showItem.uri,
			caption: showItem.caption,
		},
	});
	return okReply(envelope, { room: next });
}

/** @internal test helper */
export function __resetDriveRoomsForTests(): void {
	rooms.clear();
}
