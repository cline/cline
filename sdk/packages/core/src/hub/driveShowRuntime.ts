/**
 * Show materialize + director tick (neutral module).
 * Shared by hub wire handlers and driveDirectorOps so neither imports the other.
 */

import {
	DEFAULT_SHOW_PLANNER_COOLDOWN_MS,
	pickNextShowToPresent,
	planShowIntents,
	resolveAddress,
	type ShowPlannerMode,
	workCategoryFromKind,
} from "@cline/drive";
import type { AddressSet, Participant, ShowBacklogItem } from "@cline/shared";
import {
	getDriveRoomStore,
	type DriveRoomStore,
} from "./collaboration";
import { produceBrowserSnapshotShowArtifact } from "./drive-producers/produceBrowserSnapshot";
import { produceCodeWalkthroughShowArtifact } from "./drive-producers/produceCodeWalkthrough";
import { produceMermaidShowArtifact } from "./drive-producers/produceMermaid";
import { producePlanCardShowArtifact } from "./drive-producers/producePlanCard";

export type DriveLiveRoom = ReturnType<DriveRoomStore["getOrCreateLive"]>;

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
				return {
					...showItem,
					scoreReasons: [
						...new Set([
							...showItem.scoreReasons,
							"mermaid_parse_failed:empty mermaidSource",
						]),
					],
				};
			}
			try {
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
			} catch (error) {
				const reason =
					error instanceof Error
						? error.message
						: "mermaid_parse_failed:unknown";
				return {
					...showItem,
					scoreReasons: [
						...new Set([...showItem.scoreReasons, reason]),
					],
				};
			}
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

export function applyPresentedShow(
	room: DriveLiveRoom,
	showItem: ShowBacklogItem,
	options?: MaterializeShowOptions,
): DriveLiveRoom {
	const materialized =
		showItem.uri && showItem.status === "showing"
			? showItem
			: materializeShowItem(showItem, options);
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

export function addressedParticipantIdsFromAddressSet(
	addressSet: AddressSet | undefined | null,
	participants?: readonly Participant[],
): Set<string> {
	if (!addressSet) {
		return new Set();
	}
	if (addressSet.mode === "everyone") {
		// Legacy show ranking: everyone means no address filter.
		return new Set();
	}
	if (addressSet.mode === "agents") {
		return new Set(addressSet.agentIds);
	}
	if (!participants) {
		return new Set();
	}
	const resolved = resolveAddress({ addressSet, participants });
	return resolved.ok ? new Set(resolved.participantIds) : new Set();
}

/**
 * Rank planned/ready shows and present the winner (materialize + activeShowId).
 * No-op when backlog has nothing presentable.
 */
export function runShowDirectorTick(input: {
	room: DriveLiveRoom;
	preferShowId?: string | null;
	demoCapture?: boolean;
	addressedParticipantIds?: ReadonlySet<string>;
}): { room: DriveLiveRoom; presented: ShowBacklogItem | null } {
	const snapshot = getDriveRoomStore().get(input.room.roomId);
	/** Prefer stage.sharer (authoritative) over live spotlight (S1.3). */
	const spotlightParticipantId =
		snapshot?.stage.sharer?.participantId ??
		input.room.director.spotlightParticipantId ??
		input.room.spotlightParticipantId;
	const addressedParticipantIds =
		input.addressedParticipantIds ??
		addressedParticipantIdsFromAddressSet(
			snapshot?.addressSet,
			snapshot?.participants,
		);
	const ranked = pickNextShowToPresent({
		items: input.room.director.showBacklog,
		spotlightParticipantId,
		addressedParticipantIds,
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
		const next = applyPresentedShow(input.room, materialized, {
			demoCapture: input.demoCapture,
		});
		const presented =
			next.director.showBacklog.find((item) => item.id === materialized.id) ??
			null;
		return { room: next, presented };
	}
	return { room: input.room, presented: null };
}

/**
 * Present the director's activeShowId via materialize + applyPresentedShow.
 */
export function presentDirectorActiveShow(
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
