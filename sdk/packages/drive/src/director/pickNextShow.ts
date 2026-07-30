import type { ShowBacklogItem } from "@cline/shared";
import { rankShowBacklog } from "./rankBacklogs.js";

export type PickNextShowInput = {
	items: readonly ShowBacklogItem[];
	spotlightParticipantId: string | null;
	addressedParticipantIds?: ReadonlySet<string>;
	/** Prefer this id if it is still planned/ready (sticky continuity). */
	preferShowId?: string | null;
};

/**
 * Pick the next Show item to present from a ranked backlog.
 * Only `planned` / `ready` items compete (same filter as rankShowBacklog).
 */
export function pickNextShowToPresent(
	input: PickNextShowInput,
): ShowBacklogItem | null {
	const ranked = rankShowBacklog({
		items: input.items,
		spotlightParticipantId: input.spotlightParticipantId,
		addressedParticipantIds: input.addressedParticipantIds,
	});
	if (ranked.length === 0) {
		return null;
	}
	if (input.preferShowId) {
		const preferred = ranked.find(
			(entry) => entry.item.id === input.preferShowId,
		);
		if (preferred) {
			return preferred.item;
		}
	}
	return ranked[0]?.item ?? null;
}

/** Normalize enqueue status: callers may send planned or ready. */
export function normalizeEnqueuedShowStatus(
	status: ShowBacklogItem["status"],
): "planned" | "ready" {
	return status === "ready" ? "ready" : "planned";
}
