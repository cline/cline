/**
 * Pure room fold + projections. Apps import these; hub commits separately.
 */

import type { DriveEvent, RoomSnapshot, StageCard } from "@cline/shared";

function rememberEventId(ids: readonly string[], id: string): string[] {
	if (ids.includes(id)) {
		return [...ids];
	}
	return [...ids, id];
}

function upsertStageCard(
	cards: readonly StageCard[],
	card: StageCard,
): StageCard[] {
	const without = cards.filter((c) => c.category !== card.category);
	return [...without, card];
}

function cardFromWorkEvent(event: DriveEvent): StageCard | null {
	switch (event.type) {
		case "work.edit":
			return {
				id: `card_${event.id}`,
				category: "edit",
				title: event.path,
				summary: event.summary,
				workEventId: event.id,
				updatedAt: event.at,
			};
		case "work.command":
			return {
				id: `card_${event.id}`,
				category: "command",
				title: event.command,
				summary: event.failed ? "failed" : "ok",
				workEventId: event.id,
				updatedAt: event.at,
			};
		case "work.test_result":
			return {
				id: `card_${event.id}`,
				category: "test",
				title: event.label,
				summary: event.passed ? "passed" : "failed",
				workEventId: event.id,
				updatedAt: event.at,
			};
		case "work.plan_step":
			return {
				id: `card_${event.id}`,
				category: "plan",
				title: event.title,
				summary: event.summary ?? event.status,
				workEventId: event.id,
				updatedAt: event.at,
			};
		case "work.decision":
			return {
				id: `card_${event.id}`,
				category: "decision",
				title: event.title,
				summary: event.choice,
				workEventId: event.id,
				updatedAt: event.at,
			};
		default:
			return null;
	}
}

export function createEmptyRoomSnapshot(input: {
	roomId: string;
	createdAt: string;
	host?: RoomSnapshot["participants"][number];
}): RoomSnapshot {
	return {
		schemaVersion: 1,
		roomId: input.roomId,
		createdAt: input.createdAt,
		driveActive: false,
		subMode: "plan",
		participants: input.host ? [input.host] : [],
		stage: { sharer: null, cards: [] },
		addressSet: { mode: "everyone" },
		muteByParticipantId: {},
		raisedHandByParticipantId: {},
		appliedEventIds: [],
	};
}

/**
 * Pure fold. Same event sequence from the same snapshot → identical result.
 * Re-applying an event by id is a no-op (idempotent).
 */
export function reduceRoom(
	snapshot: RoomSnapshot,
	event: DriveEvent,
): RoomSnapshot {
	if (snapshot.appliedEventIds.includes(event.id)) {
		return snapshot;
	}
	if (event.roomId !== snapshot.roomId) {
		return snapshot;
	}

	const appliedEventIds = rememberEventId(snapshot.appliedEventIds, event.id);
	const base = { ...snapshot, appliedEventIds };

	switch (event.type) {
		case "control.join": {
			const exists = base.participants.some(
				(p) => p.id === event.participant.id,
			);
			return {
				...base,
				participants: exists
					? base.participants.map((p) =>
							p.id === event.participant.id ? event.participant : p,
						)
					: [...base.participants, event.participant],
			};
		}
		case "control.leave":
			return {
				...base,
				participants: base.participants.filter(
					(p) => p.id !== event.participantId,
				),
			};
		case "control.mute":
			return {
				...base,
				muteByParticipantId: {
					...base.muteByParticipantId,
					[event.participantId]: event.muted,
				},
			};
		case "control.stage":
			return {
				...base,
				stage: { ...base.stage, sharer: event.sharer },
			};
		case "control.mode":
			return {
				...base,
				subMode: event.subMode,
				driveActive: event.driveActive ?? base.driveActive,
			};
		case "control.raise_hand":
			return {
				...base,
				raisedHandByParticipantId: {
					...base.raisedHandByParticipantId,
					[event.participantId]: event.raised,
				},
			};
		case "control.address":
			return { ...base, addressSet: event.addressSet };
		case "work.edit":
		case "work.command":
		case "work.test_result":
		case "work.plan_step":
		case "work.decision": {
			const card = cardFromWorkEvent(event);
			if (!card) {
				return base;
			}
			return {
				...base,
				stage: {
					...base.stage,
					cards: upsertStageCard(base.stage.cards, card),
				},
			};
		}
		case "presence.status":
			return {
				...base,
				participants: base.participants.map((p) =>
					p.id === event.participantId ? { ...p, status: event.status } : p,
				),
			};
		case "conversation.message":
		case "conversation.narration":
		case "presence.speaking":
		case "presence.typing":
			return base;
		default: {
			const _exhaustive: never = event;
			return _exhaustive;
		}
	}
}

export function projectStage(snapshot: RoomSnapshot): RoomSnapshot["stage"] {
	return snapshot.stage;
}

export function projectRoster(
	snapshot: RoomSnapshot,
): RoomSnapshot["participants"] {
	return snapshot.participants;
}
