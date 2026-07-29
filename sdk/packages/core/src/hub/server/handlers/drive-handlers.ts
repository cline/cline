import {
	normalizeEnqueuedShowStatus,
	pickNextShowToPresent,
	setParticipantDeafened,
	setParticipantMuted,
	setSpotlight,
} from "@cline/drive";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { type ShowBacklogItem, ShowBacklogItemSchema } from "@cline/shared";
import {
	getDriveRoomStore,
	resetDriveRoomStoreForTests,
} from "../../collaboration";
import { produceMermaidShowArtifact } from "../../drive-producers/produceMermaid";
import { errorReply, type HubTransportContext, okReply } from "./context";

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

type DriveLiveRoom = ReturnType<
	ReturnType<typeof getDriveRoomStore>["getOrCreateLive"]
>;

type ShowExtraEvent =
	| {
			event: "drive.spotlight.changed";
			payload: Record<string, unknown>;
	  }
	| {
			event: "drive.show.presented";
			payload: Record<string, unknown>;
	  }
	| {
			event: "drive.show.planned";
			payload: Record<string, unknown>;
	  };

function publishRoom(
	ctx: HubTransportContext,
	room: DriveLiveRoom,
	extraEvent?: ShowExtraEvent,
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

function applyPresentedShow(
	room: DriveLiveRoom,
	showItem: ShowBacklogItem,
): DriveLiveRoom {
	const materialized = materializeShowItem(showItem);
	const showBacklog = [
		{ ...materialized, status: "showing" as const },
		...room.director.showBacklog.filter((item) => item.id !== materialized.id),
	];
	return {
		...room,
		director: {
			...room.director,
			showBacklog,
			activeShowId: materialized.id,
			stickyShowIds: [materialized.id, ...room.director.stickyShowIds].filter(
				(id, index, all) => all.indexOf(id) === index,
			),
			lastPresentedAt: new Date().toISOString(),
			spotlightParticipantId:
				room.spotlightParticipantId ?? materialized.ownerParticipantId,
		},
		spotlightParticipantId:
			room.spotlightParticipantId ?? materialized.ownerParticipantId,
	};
}

/**
 * Rank planned/ready shows and present the winner (materialize + activeShowId).
 * No-op when backlog has nothing presentable.
 */
export function runShowDirectorTick(input: {
	room: DriveLiveRoom;
	preferShowId?: string | null;
}): { room: DriveLiveRoom; presented: ShowBacklogItem | null } {
	const picked = pickNextShowToPresent({
		items: input.room.director.showBacklog,
		spotlightParticipantId:
			input.room.director.spotlightParticipantId ??
			input.room.spotlightParticipantId,
		preferShowId: input.preferShowId,
	});
	if (!picked) {
		return { room: input.room, presented: null };
	}
	const next = applyPresentedShow(input.room, picked);
	const presented =
		next.director.showBacklog.find((item) => item.id === picked.id) ?? null;
	return { room: next, presented };
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
		case "drive.show.enqueue":
			return handleShowEnqueue(ctx, envelope);
		case "drive.show.tick":
			return handleShowTick(ctx, envelope);
		default:
			return errorReply(envelope, "not_implemented", "Unknown drive command");
	}
}

function handleRoomGet(envelope: HubCommandEnvelope): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const store = getDriveRoomStore();
	store.create(roomId);
	return okReply(envelope, { room: store.getOrCreateLive(roomId) });
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
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const seated = new Set(room.seatedParticipantIds);
	if (seated.size === 0) {
		seated.add(participantId);
	}
	const result = setSpotlight({ participantId, seatedIds: seated });
	if (!result.ok) {
		return errorReply(envelope, result.code, result.message);
	}
	const from = room.spotlightParticipantId;
	const next = store.setLive({
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
	const store = getDriveRoomStore();
	store.create(roomId);
	if (
		flag === "muted" &&
		store.get(roomId)?.participants.some((p) => p.id === participantId)
	) {
		store.mute({ roomId, participantId, muted: value });
	}
	const room = store.getOrCreateLive(roomId);
	const participantAudio =
		flag === "muted"
			? setParticipantMuted(room.participantAudio, participantId, value)
			: setParticipantDeafened(room.participantAudio, participantId, value);
	const next = store.setLive({ ...room, participantAudio });
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
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const next = store.setLive(applyPresentedShow(room, parsedShow.data));
	const presented = next.director.showBacklog.find(
		(item) => item.id === parsedShow.data.id,
	);
	publishRoom(ctx, next, {
		event: "drive.show.presented",
		payload: {
			showItemId: presented?.id ?? parsedShow.data.id,
			ownerParticipantId:
				presented?.ownerParticipantId ?? parsedShow.data.ownerParticipantId,
			uri: presented?.uri,
			caption: presented?.caption ?? parsedShow.data.caption,
			title: presented?.title ?? parsedShow.data.title,
		},
	});
	return okReply(envelope, { room: next });
}

function handleShowEnqueue(
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
	const presentNow = readBoolean(envelope.payload, "presentNow") === true;
	const status = normalizeEnqueuedShowStatus(parsedShow.data.status);
	const enqueued: ShowBacklogItem = {
		...parsedShow.data,
		status,
	};
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const showBacklog = [
		enqueued,
		...room.director.showBacklog.filter((item) => item.id !== enqueued.id),
	];
	let next = store.setLive({
		...room,
		director: {
			...room.director,
			showBacklog,
		},
	});
	publishRoom(ctx, next, {
		event: "drive.show.planned",
		payload: {
			showItemId: enqueued.id,
			ownerParticipantId: enqueued.ownerParticipantId,
			status: enqueued.status,
			title: enqueued.title,
			priority: enqueued.priority,
		},
	});
	if (presentNow) {
		const tick = runShowDirectorTick({
			room: next,
			preferShowId: enqueued.id,
		});
		next = store.setLive(tick.room);
		if (tick.presented) {
			publishRoom(ctx, next, {
				event: "drive.show.presented",
				payload: {
					showItemId: tick.presented.id,
					ownerParticipantId: tick.presented.ownerParticipantId,
					uri: tick.presented.uri,
					caption: tick.presented.caption,
					title: tick.presented.title,
				},
			});
		}
	}
	return okReply(envelope, { room: next });
}

function handleShowTick(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const preferShowId = readString(envelope.payload, "preferShowId");
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const tick = runShowDirectorTick({
		room,
		preferShowId,
	});
	if (!tick.presented) {
		return okReply(envelope, { room, presented: null });
	}
	const next = store.setLive(tick.room);
	publishRoom(ctx, next, {
		event: "drive.show.presented",
		payload: {
			showItemId: tick.presented.id,
			ownerParticipantId: tick.presented.ownerParticipantId,
			uri: tick.presented.uri,
			caption: tick.presented.caption,
			title: tick.presented.title,
		},
	});
	return okReply(envelope, { room: next, presented: tick.presented });
}

/** @internal test helper — clears collaboration store (single live Map). */
export function __resetDriveRoomsForTests(): void {
	resetDriveRoomStoreForTests();
}
