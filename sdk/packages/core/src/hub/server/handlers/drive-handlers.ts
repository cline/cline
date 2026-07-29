import {
	advanceScriptBeat,
	DEFAULT_SHOW_PLANNER_COOLDOWN_MS,
	normalizeEnqueuedShowStatus,
	pickNextShowToPresent,
	planShowIntents,
	setParticipantDeafened,
	setParticipantMuted,
	type ShowPlannerMode,
	workCategoryFromKind,
} from "@cline/drive";
import type {
	HubCommandEnvelope,
	HubReplyEnvelope,
	StageSharer,
} from "@cline/shared";
import {
	DirectorScriptSchema,
	DoBacklogItemSchema,
	type ShowBacklogItem,
	ShowBacklogItemSchema,
} from "@cline/shared";
import {
	getDriveRoomStore,
	resetDriveRoomStoreForTests,
} from "../../collaboration";
import { produceMermaidShowArtifact } from "../../drive-producers/produceMermaid";
import { producePlanCardShowArtifact } from "../../drive-producers/producePlanCard";
import { produceCodeWalkthroughShowArtifact } from "../../drive-producers/produceCodeWalkthrough";
import { produceBrowserSnapshotShowArtifact } from "../../drive-producers/produceBrowserSnapshot";
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
	  }
	| {
			event: "drive.script.beat";
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

export type MaterializeShowOptions = {
	demoCapture?: boolean;
};

/**
 * Materialize show artifacts that still need production.
 * Unknown tools leave the item unchanged (caller may keep planned).
 */
export function materializeShowItem(
	showItem: ShowBacklogItem,
	options?: MaterializeShowOptions,
): ShowBacklogItem {
	if (showItem.uri) {
		return showItem;
	}
	const tool = showItem.produce.tool;
	switch (tool) {
		case "render_mermaid": {
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
					...new Set([
						...showItem.scoreReasons,
						...produced.item.scoreReasons,
					]),
				],
			};
		}
		case "render_plan_card": {
			const stepsRaw = showItem.produce.args.steps;
			const steps = Array.isArray(stepsRaw)
				? stepsRaw.filter((step): step is string => typeof step === "string")
				: undefined;
			const planTitle =
				typeof showItem.produce.args.planTitle === "string"
					? showItem.produce.args.planTitle
					: showItem.title;
			const produced = producePlanCardShowArtifact({
				ownerParticipantId: showItem.ownerParticipantId,
				title: showItem.title,
				caption: showItem.caption,
				templateId: showItem.produce.templateId,
				planTitle,
				steps,
			});
			return {
				...showItem,
				uri: produced.item.uri,
				status: "ready",
				scoreReasons: [
					...new Set([
						...showItem.scoreReasons,
						...produced.item.scoreReasons,
					]),
				],
			};
		}
		case "render_code_walkthrough": {
			const path =
				typeof showItem.produce.args.path === "string" &&
				showItem.produce.args.path.trim()
					? showItem.produce.args.path.trim()
					: "src/unknown.ts";
			const startLine =
				typeof showItem.produce.args.startLine === "number"
					? showItem.produce.args.startLine
					: undefined;
			const endLine =
				typeof showItem.produce.args.endLine === "number"
					? showItem.produce.args.endLine
					: undefined;
			const snippet =
				typeof showItem.produce.args.snippet === "string"
					? showItem.produce.args.snippet
					: undefined;
			const produced = produceCodeWalkthroughShowArtifact({
				ownerParticipantId: showItem.ownerParticipantId,
				title: showItem.title,
				caption: showItem.caption,
				templateId: showItem.produce.templateId,
				path,
				startLine,
				endLine,
				snippet,
			});
			return {
				...showItem,
				uri: produced.item.uri,
				status: "ready",
				scoreReasons: [
					...new Set([
						...showItem.scoreReasons,
						...produced.item.scoreReasons,
					]),
				],
			};
		}
		case "drive_browser_snapshot": {
			const produced = produceBrowserSnapshotShowArtifact({
				ownerParticipantId: showItem.ownerParticipantId,
				title: showItem.title,
				caption: showItem.caption,
				templateId: showItem.produce.templateId,
				url:
					typeof showItem.produce.args.url === "string"
						? showItem.produce.args.url
						: undefined,
				demoCapture: options?.demoCapture === true,
			});
			if (!produced.ok) {
				return {
					...showItem,
					status: "planned",
					scoreReasons: [
						...new Set([
							...showItem.scoreReasons,
							...produced.item.scoreReasons,
						]),
					],
				};
			}
			return {
				...showItem,
				uri: produced.item.uri,
				status: "ready",
				scoreReasons: [
					...new Set([
						...showItem.scoreReasons,
						...produced.item.scoreReasons,
					]),
				],
			};
		}
		default:
			return {
				...showItem,
				scoreReasons: [
					...new Set([...showItem.scoreReasons, `unknown_produce_tool:${tool}`]),
				],
			};
	}
}

function applyPresentedShow(
	room: DriveLiveRoom,
	showItem: ShowBacklogItem,
): DriveLiveRoom {
	const materialized =
		showItem.uri && showItem.status === "showing"
			? showItem
			: materializeShowItem(showItem);
	if (!materialized.uri) {
		return room;
	}
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
	demoCapture?: boolean;
}): { room: DriveLiveRoom; presented: ShowBacklogItem | null } {
	const snapshot = getDriveRoomStore().get(input.room.roomId);
	/** Prefer stage.sharer (authoritative) over live spotlight (S1.3). */
	const spotlightParticipantId =
		snapshot?.stage.sharer?.participantId ??
		input.room.director.spotlightParticipantId ??
		input.room.spotlightParticipantId;
	const ranked = pickNextShowToPresent({
		items: input.room.director.showBacklog,
		spotlightParticipantId,
		preferShowId: input.preferShowId,
	});
	if (!ranked) {
		return { room: input.room, presented: null };
	}

	// Prefer ranked winner; if it cannot materialize, try remaining ready/planned.
	const ordered = [
		ranked,
		...input.room.director.showBacklog.filter(
			(item) =>
				item.id !== ranked.id &&
				(item.status === "planned" || item.status === "ready"),
		),
	];
	for (const candidate of ordered) {
		const materialized = materializeShowItem(candidate, {
			demoCapture: input.demoCapture,
		});
		if (!materialized.uri) {
			continue;
		}
		const next = applyPresentedShow(input.room, materialized);
		const presented =
			next.director.showBacklog.find((item) => item.id === materialized.id) ??
			null;
		return { room: next, presented };
	}
	return { room: input.room, presented: null };
}

/**
 * Heuristic show planner: enqueue template intents from a work signal.
 * Optionally ticks the show director when tickOnWork is enabled (default).
 */
export function runShowPlannerFromWork(input: {
	room: DriveLiveRoom;
	workKind: "edit" | "command" | "test_result";
	ownerParticipantId: string;
	nowMs?: number;
}): {
	room: DriveLiveRoom;
	planned: ShowBacklogItem[];
	reasons: string[];
	presented: ShowBacklogItem | null;
} {
	const mode: ShowPlannerMode =
		input.room.director.showPlannerMode === "off" ? "off" : "heuristic";
	const cooldownMs =
		input.room.director.showPlannerCooldownMs ??
		DEFAULT_SHOW_PLANNER_COOLDOWN_MS;
	const nowMs = input.nowMs ?? Date.now();
	const plannedResult = planShowIntents({
		signal: {
			kind: "work",
			category: workCategoryFromKind(input.workKind),
		},
		ownerParticipantId: input.ownerParticipantId,
		existingShowBacklog: input.room.director.showBacklog,
		nowMs,
		lastEnqueuedAtByTemplate:
			input.room.director.showPlannerLastAtByTemplate ?? {},
		cooldownMs,
		mode,
	});
	if (plannedResult.items.length === 0) {
		return {
			room: input.room,
			planned: [],
			reasons: plannedResult.reasons,
			presented: null,
		};
	}

	const enqueuedAt = new Date(nowMs).toISOString();
	const lastAt = {
		...(input.room.director.showPlannerLastAtByTemplate ?? {}),
	};
	for (const item of plannedResult.items) {
		const templateId = item.produce.templateId;
		if (templateId) {
			lastAt[templateId] = enqueuedAt;
		}
	}

	const showBacklog = [
		...plannedResult.items,
		...input.room.director.showBacklog.filter(
			(existing) =>
				!plannedResult.items.some((item) => item.id === existing.id),
		),
	];
	let room: DriveLiveRoom = {
		...input.room,
		director: {
			...input.room.director,
			showBacklog,
			showPlannerLastAtByTemplate: lastAt,
		},
	};

	const archItem = plannedResult.items.find(
		(item) => item.produce.templateId === "arch.overview",
	);
	if (archItem && !room.director.activeScript) {
		const script = {
			scriptId: `planner_${archItem.id}`,
			ownerParticipantId: input.ownerParticipantId,
			title: "Architecture walkthrough",
			stickyShowIds: [archItem.id],
			beats: [
				{
					beatId: "planner-arch-1",
					say: "Here is the architecture overview.",
					showItemId: archItem.id,
					sticky: { mode: "hold" as const },
					advance: "on_human" as const,
				},
				{
					beatId: "planner-arch-2",
					say: "Still on the architecture diagram — advance when ready.",
					showItemId: archItem.id,
					sticky: { mode: "hold" as const },
					advance: "on_human" as const,
				},
			],
		};
		room = {
			...room,
			director: {
				...room.director,
				activeScript: script,
				activeBeatId: "planner-arch-1",
				activeShowId: archItem.id,
				stickyShowIds: [
					archItem.id,
					...room.director.stickyShowIds.filter((id) => id !== archItem.id),
				],
			},
		};
	}

	const tickOnWork = input.room.director.tickOnWork !== false;
	let presented: ShowBacklogItem | null = null;
	if (tickOnWork) {
		const tick = runShowDirectorTick({
			room,
			preferShowId: plannedResult.items[0]?.id,
		});
		room = tick.room;
		presented = tick.presented;
	}

	return {
		room,
		planned: plannedResult.items,
		reasons: plannedResult.reasons,
		presented,
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
		case "drive.show.enqueue":
			return handleShowEnqueue(ctx, envelope);
		case "drive.show.tick":
			return handleShowTick(ctx, envelope);
		case "drive.do.enqueue":
			return handleDoEnqueue(ctx, envelope);
		case "drive.planner.set":
			return handlePlannerSet(ctx, envelope);
		case "drive.script.attach":
			return handleScriptAttach(ctx, envelope);
		case "drive.script.advance":
			return handleScriptAdvance(ctx, envelope);
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
	const snapshot = store.get(roomId);
	const live = store.getOrCreateLive(roomId);
	const seated = new Set(
		snapshot?.participants.map((p) => p.id) ?? live.seatedParticipantIds,
	);
	if (seated.size === 0) {
		seated.add(participantId);
	} else if (!seated.has(participantId)) {
		return errorReply(
			envelope,
			"not_seated",
			`Participant ${participantId} is not seated`,
		);
	}

	const fromSnapshot = snapshot?.participants.find((p) => p.id === participantId);
	const kind: StageSharer["kind"] =
		fromSnapshot?.kind === "human" ||
		participantId === "drive:human" ||
		participantId === "human" ||
		participantId === "you"
			? "human"
			: "agent";
	const sharer: StageSharer = { kind, participantId };
	const from = live.spotlightParticipantId;

	const committed = store.setStage({
		roomId,
		sharer,
		pin: null,
		actorId: participantId,
	});
	const next = store.getOrCreateLive(roomId);
	publishRoom(ctx, next, {
		event: "drive.spotlight.changed",
		payload: {
			from,
			to: next.spotlightParticipantId,
			reason,
			via: "call_set_stage",
		},
	});
	ctx.publish(
		ctx.buildEvent("room.event", {
			roomId,
			seq: committed.seq,
			event: committed.event,
		}),
	);
	ctx.publish(
		ctx.buildEvent("room.snapshot", {
			roomId,
			snapshot: committed.snapshot,
			seq: committed.seq,
		}),
	);
	return okReply(envelope, {
		room: next,
		snapshot: committed.snapshot,
		seq: committed.seq,
	});
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

function handleDoEnqueue(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const parsedDo = DoBacklogItemSchema.safeParse(envelope.payload?.doItem);
	if (!parsedDo.success) {
		return errorReply(
			envelope,
			"invalid_payload",
			"doItem must be a valid DoBacklogItem",
		);
	}
	const enqueued = {
		...parsedDo.data,
		status:
			parsedDo.data.status === "done" || parsedDo.data.status === "blocked"
				? parsedDo.data.status
				: ("queued" as const),
	};
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const doBacklog = [
		enqueued,
		...room.director.doBacklog.filter((item) => item.id !== enqueued.id),
	];
	const next = store.setLive({
		...room,
		director: {
			...room.director,
			doBacklog,
		},
	});
	publishRoom(ctx, next);
	return okReply(envelope, { room: next, doItem: enqueued });
}

function handlePlannerSet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const modeRaw = readString(envelope.payload, "showPlannerMode");
	const mode =
		modeRaw === "off" || modeRaw === "heuristic" ? modeRaw : undefined;
	const tickOnWork = readBoolean(envelope.payload, "tickOnWork");
	const cooldownRaw = envelope.payload?.showPlannerCooldownMs;
	const cooldownMs =
		typeof cooldownRaw === "number" &&
		Number.isFinite(cooldownRaw) &&
		cooldownRaw >= 0
			? Math.floor(cooldownRaw)
			: undefined;
	if (mode === undefined && tickOnWork === undefined && cooldownMs === undefined) {
		return errorReply(
			envelope,
			"invalid_payload",
			"showPlannerMode, tickOnWork, or showPlannerCooldownMs required",
		);
	}
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const next = store.setLive({
		...room,
		director: {
			...room.director,
			...(mode !== undefined ? { showPlannerMode: mode } : {}),
			...(tickOnWork !== undefined ? { tickOnWork } : {}),
			...(cooldownMs !== undefined
				? { showPlannerCooldownMs: cooldownMs }
				: {}),
		},
	});
	publishRoom(ctx, next);
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

function publishBeat(
	ctx: HubTransportContext,
	room: DriveLiveRoom,
	beatId: string | null,
	say: string,
	showItemId: string | null,
): void {
	publishRoom(ctx, room, {
		event: "drive.script.beat",
		payload: {
			beatId,
			say,
			showItemId,
			stickyShowIds: room.director.stickyShowIds,
			activeScriptId: room.director.activeScript?.scriptId ?? null,
		},
	});
}

function presentDirectorActiveShow(
	room: DriveLiveRoom,
): { room: DriveLiveRoom; presented: ShowBacklogItem | null } {
	const showId = room.director.activeShowId;
	if (!showId) {
		return { room, presented: null };
	}
	const item = room.director.showBacklog.find((entry) => entry.id === showId);
	if (!item) {
		return { room, presented: null };
	}
	const next = applyPresentedShow(room, item);
	const presented =
		next.director.showBacklog.find((entry) => entry.id === showId) ?? null;
	return { room: next, presented };
}

function handleScriptAttach(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const parsedScript = DirectorScriptSchema.safeParse(envelope.payload?.script);
	if (!parsedScript.success) {
		return errorReply(
			envelope,
			"invalid_payload",
			"script must be a valid DirectorScript",
		);
	}
	const script = parsedScript.data;
	const extraShows = Array.isArray(envelope.payload?.showItems)
		? envelope.payload.showItems
				.map((entry) => ShowBacklogItemSchema.safeParse(entry))
				.filter((entry) => entry.success)
				.map((entry) => entry.data)
		: [];

	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	let showBacklog = [...room.director.showBacklog];
	for (const show of extraShows) {
		showBacklog = [
			{ ...show, status: normalizeEnqueuedShowStatus(show.status) },
			...showBacklog.filter((item) => item.id !== show.id),
		];
	}

	const seeded = advanceScriptBeat({
		state: {
			...room.director,
			showBacklog,
			activeScript: script,
			activeBeatId: null,
			activeShowId: null,
			stickyShowIds: [],
		},
		script,
	});
	let next = store.setLive({
		...room,
		director: seeded,
		spotlightParticipantId:
			room.spotlightParticipantId ?? seeded.spotlightParticipantId,
	});
	const presented = presentDirectorActiveShow(next);
	next = store.setLive(presented.room);
	const beat = script.beats.find((entry) => entry.beatId === seeded.activeBeatId);
	if (presented.presented) {
		publishRoom(ctx, next, {
			event: "drive.show.presented",
			payload: {
				showItemId: presented.presented.id,
				ownerParticipantId: presented.presented.ownerParticipantId,
				uri: presented.presented.uri,
				caption: beat?.say ?? presented.presented.caption,
				title: presented.presented.title,
			},
		});
	} else {
		publishRoom(ctx, next);
	}
	publishBeat(
		ctx,
		next,
		seeded.activeBeatId,
		beat?.say ?? "",
		seeded.activeShowId,
	);
	return okReply(envelope, { room: next, beatId: seeded.activeBeatId });
}

function handleScriptAdvance(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const script = room.director.activeScript;
	if (!script) {
		return errorReply(
			envelope,
			"no_active_script",
			"No active DirectorScript on this room",
		);
	}
	const previousShowId = room.director.activeShowId;
	const advanced = advanceScriptBeat({
		state: room.director,
		script,
	});
	let next = store.setLive({
		...room,
		director: advanced,
	});
	const beat = script.beats.find(
		(entry) => entry.beatId === advanced.activeBeatId,
	);
	const showChanged = advanced.activeShowId !== previousShowId;
	if (showChanged && advanced.activeShowId) {
		const presented = presentDirectorActiveShow(next);
		next = store.setLive(presented.room);
		if (presented.presented) {
			publishRoom(ctx, next, {
				event: "drive.show.presented",
				payload: {
					showItemId: presented.presented.id,
					ownerParticipantId: presented.presented.ownerParticipantId,
					uri: presented.presented.uri,
					caption: beat?.say ?? presented.presented.caption,
					title: presented.presented.title,
				},
			});
		} else {
			publishRoom(ctx, next);
		}
	} else {
		publishRoom(ctx, next);
	}
	publishBeat(
		ctx,
		next,
		advanced.activeBeatId,
		beat?.say ?? "",
		advanced.activeShowId,
	);
	return okReply(envelope, {
		room: next,
		beatId: advanced.activeBeatId,
		say: beat?.say ?? "",
	});
}

/** @internal test helper — clears collaboration store (single live Map). */
export function __resetDriveRoomsForTests(): void {
	resetDriveRoomStoreForTests();
}
