import type {
	AgentMediaBag,
	DirectorScript,
	DoBacklogItem,
	ShowBacklogItem,
	StageDirectorState,
} from "@cline/shared";

export type RankedShow = {
	item: ShowBacklogItem;
	score: number;
	reasons: string[];
};

export function mergeAgentShowBacklogs(
	bags: readonly AgentMediaBag[],
): ShowBacklogItem[] {
	return bags.flatMap((bag) => bag.showBacklog);
}

export function rankShowBacklog(input: {
	items: readonly ShowBacklogItem[];
	spotlightParticipantId: string | null;
	addressedParticipantIds?: ReadonlySet<string>;
}): RankedShow[] {
	const addressed = input.addressedParticipantIds ?? new Set<string>();
	return input.items
		.filter((item) => item.status === "planned" || item.status === "ready")
		.map((item) => {
			let score = item.priority;
			const reasons = [...item.scoreReasons];
			if (
				input.spotlightParticipantId &&
				item.ownerParticipantId === input.spotlightParticipantId
			) {
				score += 100;
				reasons.push("spotlight_owner");
			}
			if (addressed.has(item.ownerParticipantId)) {
				score += 40;
				reasons.push("addressed_owner");
			}
			return { item, score, reasons };
		})
		.sort((a, b) => b.score - a.score);
}

export function rankDoBacklog(
	items: readonly DoBacklogItem[],
): DoBacklogItem[] {
	return [...items]
		.filter((item) => item.status === "queued" || item.status === "active")
		.sort((a, b) => b.priority - a.priority);
}

export function pickActiveScript(
	bags: readonly AgentMediaBag[],
	spotlightParticipantId: string | null,
): DirectorScript | null {
	if (spotlightParticipantId) {
		const bag = bags.find(
			(entry) => entry.participantId === spotlightParticipantId,
		);
		if (bag?.scripts[0]) {
			return bag.scripts[0];
		}
	}
	for (const bag of bags) {
		if (bag.scripts[0]) {
			return bag.scripts[0];
		}
	}
	return null;
}

export function advanceScriptBeat(input: {
	state: StageDirectorState;
	script: DirectorScript;
}): StageDirectorState {
	const beats = input.script.beats;
	if (beats.length === 0) {
		return input.state;
	}
	const currentIndex = beats.findIndex(
		(beat) => beat.beatId === input.state.activeBeatId,
	);
	const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
	if (nextIndex >= beats.length) {
		return {
			...input.state,
			activeBeatId: beats[beats.length - 1]?.beatId ?? null,
			activeScript: input.script,
		};
	}
	const next = beats[nextIndex];
	const stickyShowIds =
		next.sticky.mode === "replace"
			? [next.showItemId]
			: [
					...new Set([
						...input.state.stickyShowIds,
						next.showItemId,
						...input.script.stickyShowIds,
					]),
				];
	return {
		...input.state,
		activeScript: input.script,
		activeBeatId: next.beatId,
		activeShowId: next.showItemId,
		stickyShowIds,
		spotlightParticipantId:
			input.state.spotlightParticipantId ?? input.script.ownerParticipantId,
		lastPresentedAt: new Date().toISOString(),
	};
}

export function buildDirectorStateFromBags(input: {
	bags: readonly AgentMediaBag[];
	doBacklog: readonly DoBacklogItem[];
	spotlightParticipantId: string | null;
}): StageDirectorState {
	const showBacklog = mergeAgentShowBacklogs(input.bags);
	const ranked = rankShowBacklog({
		items: showBacklog,
		spotlightParticipantId: input.spotlightParticipantId,
	});
	const script = pickActiveScript(input.bags, input.spotlightParticipantId);
	const firstBeat = script?.beats[0] ?? null;
	return {
		doBacklog: rankDoBacklog(input.doBacklog),
		showBacklog,
		activeScript: script,
		activeBeatId: firstBeat?.beatId ?? null,
		activeShowId:
			firstBeat?.showItemId ?? ranked[0]?.item.id ?? null,
		stickyShowIds: firstBeat
			? [firstBeat.showItemId, ...(script?.stickyShowIds ?? [])]
			: ranked[0]
				? [ranked[0].item.id]
				: [],
		spotlightParticipantId: input.spotlightParticipantId,
		lastPresentedAt: null,
	};
}
