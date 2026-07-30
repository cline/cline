/**
 * Single room fold for the Drive webview — same reduceRoom kernel as the hub.
 * room_snapshot replaces local state; drive_event folds then reconciles with hub.
 */

import { reduceRoom } from "@cline/drive";
import { parseDriveEvent, type RoomSnapshot } from "@cline/shared";

/**
 * Fold one incoming DriveEvent onto local room state.
 * Bootstraps from the hub snapshot when local is missing or for another room.
 * If the hub snapshot is ahead (missed intermediate events), prefer hub.
 */
export function foldIncomingDriveEvent(input: {
	local: RoomSnapshot | null;
	event: unknown;
	hubSnapshot?: RoomSnapshot | null;
}): RoomSnapshot {
	const hub =
		input.hubSnapshot && typeof input.hubSnapshot === "object"
			? input.hubSnapshot
			: null;

	let event;
	try {
		event = parseDriveEvent(input.event);
	} catch {
		if (hub) {
			return hub;
		}
		if (input.local) {
			return input.local;
		}
		throw new Error("foldIncomingDriveEvent: no event and no snapshot");
	}

	const base =
		input.local && input.local.roomId === event.roomId
			? input.local
			: hub && hub.roomId === event.roomId
				? hub
				: null;

	if (!base) {
		if (hub) {
			return hub;
		}
		throw new Error(
			`foldIncomingDriveEvent: no base room for event roomId=${event.roomId}`,
		);
	}

	const folded = reduceRoom(base, event);

	if (hub && hub.roomId === event.roomId) {
		const hubAhead =
			hub.appliedEventIds.length > folded.appliedEventIds.length;
		const hubHasEvent = hub.appliedEventIds.includes(event.id);
		const foldedHasEvent = folded.appliedEventIds.includes(event.id);
		if (hubAhead || (hubHasEvent && !foldedHasEvent)) {
			return hub;
		}
	}

	return folded;
}
