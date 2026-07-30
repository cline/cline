/**
 * Pure seat-source set deltas + pack remove / dismiss plans (DRV-ROSTER-PACK).
 */

import type { Participant, SeatSource } from "@cline/shared";

export type SeatSourceDelta =
	| { readonly type: "add"; readonly source: SeatSource }
	| { readonly type: "remove"; readonly source: SeatSource }
	| { readonly type: "clear" };

export type SeatPlanAction =
	| {
			readonly action: "update";
			readonly participantId: string;
			readonly seatSources: SeatSource[];
	  }
	| { readonly action: "leave"; readonly participantId: string };

export function seatSourcesEqual(a: SeatSource, b: SeatSource): boolean {
	if (a.kind !== b.kind) {
		return false;
	}
	switch (a.kind) {
		case "manual":
			return b.kind === "manual";
		case "pack":
			return b.kind === "pack" && a.packId === b.packId;
		case "spawn":
			return b.kind === "spawn" && a.parentId === b.parentId;
		default: {
			const _never: never = a;
			return _never;
		}
	}
}

export function applySeatSourceDelta(
	current: readonly SeatSource[],
	delta: SeatSourceDelta,
): {
	next: SeatSource[];
	/** True when next is empty — host should leave the participant. */
	shouldLeave: boolean;
} {
	switch (delta.type) {
		case "clear":
			return { next: [], shouldLeave: true };
		case "add": {
			if (current.some((source) => seatSourcesEqual(source, delta.source))) {
				return { next: [...current], shouldLeave: current.length === 0 };
			}
			const next = [...current, delta.source];
			return { next, shouldLeave: next.length === 0 };
		}
		case "remove": {
			const next = current.filter(
				(source) => !seatSourcesEqual(source, delta.source),
			);
			return { next, shouldLeave: next.length === 0 };
		}
		default: {
			const _never: never = delta;
			return _never;
		}
	}
}

/**
 * Plan seat updates when removing a pack from the call.
 * Agents without that pack source are untouched.
 */
export function planRemoveRosterPack(
	participants: readonly Participant[],
	packId: string,
): SeatPlanAction[] {
	const packSource: SeatSource = { kind: "pack", packId };
	const actions: SeatPlanAction[] = [];
	for (const participant of participants) {
		if (participant.kind !== "agent") {
			continue;
		}
		if (
			!participant.seatSources.some((source) =>
				seatSourcesEqual(source, packSource),
			)
		) {
			continue;
		}
		const delta = applySeatSourceDelta(participant.seatSources, {
			type: "remove",
			source: packSource,
		});
		if (delta.shouldLeave) {
			actions.push({ action: "leave", participantId: participant.id });
		} else {
			actions.push({
				action: "update",
				participantId: participant.id,
				seatSources: delta.next,
			});
		}
	}
	return actions;
}

/**
 * Dismiss a participant: clear its sources (leave), then cascade leave to
 * agents whose seatSources empty after dropping spawns of leaving parents.
 */
export function planDismissParticipant(
	participants: readonly Participant[],
	participantId: string,
): SeatPlanAction[] {
	const agents = participants.filter((p) => p.kind === "agent");
	const sourcesById = new Map(
		agents.map((agent) => [agent.id, [...agent.seatSources] as SeatSource[]]),
	);
	if (!sourcesById.has(participantId)) {
		return [];
	}

	sourcesById.set(participantId, []);
	const leaving = new Set<string>([participantId]);

	let changed = true;
	while (changed) {
		changed = false;
		for (const [id, sources] of sourcesById) {
			if (leaving.has(id)) {
				continue;
			}
			const next = sources.filter(
				(source) =>
					!(source.kind === "spawn" && leaving.has(source.parentId)),
			);
			if (next.length !== sources.length) {
				sourcesById.set(id, next);
				changed = true;
			}
			if (next.length === 0) {
				leaving.add(id);
				changed = true;
			}
		}
	}

	const actions: SeatPlanAction[] = [];
	for (const agent of agents) {
		const sources = sourcesById.get(agent.id) ?? [];
		if (leaving.has(agent.id)) {
			actions.push({ action: "leave", participantId: agent.id });
			continue;
		}
		const unchanged =
			sources.length === agent.seatSources.length &&
			sources.every((source, index) => {
				const prior = agent.seatSources[index];
				return prior !== undefined && seatSourcesEqual(source, prior);
			});
		if (!unchanged) {
			actions.push({
				action: "update",
				participantId: agent.id,
				seatSources: sources,
			});
		}
	}
	return actions;
}
