/**
 * Director show ops over DriveRoomStore (host commit path).
 * Show runtime lives in driveShowRuntime (handlers must not import this file).
 */

import {
	advanceScriptBeat,
	normalizeEnqueuedShowStatus,
} from "@cline/drive";
import type { DirectorScript, ShowBacklogItem } from "@cline/shared";
import {
	getDriveRoomStore,
	type DriveRoomStore,
} from "./collaboration";
import {
	applyPresentedShow,
	materializeShowItem,
	presentDirectorActiveShow,
	runShowDirectorTick,
	runShowPlannerFromWork,
} from "./driveShowRuntime";

type DriveLiveRoom = ReturnType<DriveRoomStore["getOrCreateLive"]>;

export type DirectorCommitResult = {
	room: DriveLiveRoom;
	presented: ShowBacklogItem | null;
	planned: ShowBacklogItem | null;
	beatId?: string | null;
	say?: string;
	showChanged?: boolean;
	plannedShows?: ShowBacklogItem[];
	plannerReasons?: string[];
	errorCode?: string;
	errorMessage?: string;
};

export function enqueueShowOnStore(input: {
	roomId: string;
	showItem: ShowBacklogItem;
	presentNow?: boolean;
	demoCapture?: boolean;
	store?: DriveRoomStore;
}): DirectorCommitResult {
	const store = input.store ?? getDriveRoomStore();
	store.create(input.roomId);
	const room = store.getOrCreateLive(input.roomId);
	const status = normalizeEnqueuedShowStatus(input.showItem.status);
	const enqueued: ShowBacklogItem = {
		...input.showItem,
		status,
	};
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
	let presented: ShowBacklogItem | null = null;
	if (input.presentNow) {
		const tick = runShowDirectorTick({
			room: next,
			preferShowId: enqueued.id,
			demoCapture: input.demoCapture,
		});
		next = store.setLive(tick.room);
		presented = tick.presented;
	}
	return { room: next, presented, planned: enqueued };
}

export function presentShowOnStore(input: {
	roomId: string;
	showItem: ShowBacklogItem;
	demoCapture?: boolean;
	store?: DriveRoomStore;
}): DirectorCommitResult {
	const store = input.store ?? getDriveRoomStore();
	store.create(input.roomId);
	const room = store.getOrCreateLive(input.roomId);
	const materialized =
		input.showItem.uri && input.showItem.status === "showing"
			? input.showItem
			: materializeShowItem(input.showItem, {
					demoCapture: input.demoCapture,
				});
	if (!materialized.uri) {
		const parseReason = materialized.scoreReasons.find((reason) =>
			reason.startsWith("mermaid_parse_failed"),
		);
		return {
			room,
			presented: null,
			planned: null,
			errorCode: parseReason ? "mermaid_parse_failed" : "show_materialize_failed",
			errorMessage:
				parseReason ??
				"Show item could not be materialized (missing uri)",
		};
	}
	const next = store.setLive(
		applyPresentedShow(room, { ...materialized, status: "showing" }, {
			demoCapture: input.demoCapture,
		}),
	);
	const presented =
		next.director.showBacklog.find((item) => item.id === materialized.id) ??
		null;
	return { room: next, presented, planned: null };
}

export function tickShowOnStore(input: {
	roomId: string;
	preferShowId?: string | null;
	demoCapture?: boolean;
	store?: DriveRoomStore;
}): DirectorCommitResult {
	const store = input.store ?? getDriveRoomStore();
	store.create(input.roomId);
	const room = store.getOrCreateLive(input.roomId);
	const tick = runShowDirectorTick({
		room,
		preferShowId: input.preferShowId,
		demoCapture: input.demoCapture,
	});
	if (!tick.presented) {
		return { room, presented: null, planned: null };
	}
	const next = store.setLive(tick.room);
	return { room: next, presented: tick.presented, planned: null };
}

export function attachScriptOnStore(input: {
	roomId: string;
	script: DirectorScript;
	showItems?: ShowBacklogItem[];
	store?: DriveRoomStore;
}): DirectorCommitResult {
	const store = input.store ?? getDriveRoomStore();
	store.create(input.roomId);
	const room = store.getOrCreateLive(input.roomId);
	const script = input.script;
	const extraShows = input.showItems ?? [];
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
	return {
		room: next,
		presented: presented.presented,
		planned: null,
		beatId: seeded.activeBeatId,
		say: beat?.say ?? "",
	};
}

export function advanceScriptOnStore(input: {
	roomId: string;
	store?: DriveRoomStore;
}): DirectorCommitResult {
	const store = input.store ?? getDriveRoomStore();
	store.create(input.roomId);
	const room = store.getOrCreateLive(input.roomId);
	const script = room.director.activeScript;
	if (!script) {
		return {
			room,
			presented: null,
			planned: null,
			errorCode: "no_active_script",
			errorMessage: "No active DirectorScript on this room",
		};
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
	let presented: ShowBacklogItem | null = null;
	if (showChanged && advanced.activeShowId) {
		const presentedResult = presentDirectorActiveShow(next);
		next = store.setLive(presentedResult.room);
		presented = presentedResult.presented;
	}
	return {
		room: next,
		presented,
		planned: null,
		beatId: advanced.activeBeatId,
		say: beat?.say ?? "",
		showChanged,
	};
}

export function planFromWorkOnStore(input: {
	roomId: string;
	workKind: "edit" | "command" | "test_result";
	ownerParticipantId: string;
	nowMs?: number;
	store?: DriveRoomStore;
}): DirectorCommitResult {
	const store = input.store ?? getDriveRoomStore();
	store.create(input.roomId);
	const room = store.getOrCreateLive(input.roomId);
	const planner = runShowPlannerFromWork({
		room,
		workKind: input.workKind,
		ownerParticipantId: input.ownerParticipantId,
		nowMs: input.nowMs,
	});
	if (planner.planned.length === 0) {
		return {
			room,
			presented: null,
			planned: null,
			plannedShows: [],
			plannerReasons: planner.reasons,
		};
	}
	const next = store.setLive(planner.room);
	return {
		room: next,
		presented: planner.presented,
		planned: planner.planned[0] ?? null,
		plannedShows: planner.planned,
		plannerReasons: planner.reasons,
	};
}
