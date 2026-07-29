/**
 * Local Cline DriveHostPort adapter (ARD-0013).
 * Hub command handlers remain the primary entry; this adapter is the
 * commit/broadcast/facets boundary for conformance and future remote hosts.
 */

import {
	CLINE_HOST_CAPABILITIES,
	type DriveHostPort,
	type PromptRewriteDecision,
	type RoomOp,
} from "@cline/drive";
import type { DriveEvent, RoomSnapshot } from "@cline/shared";
import { parseDriveFacetValues } from "@cline/shared";
import {
	type DriveRoomStore,
	getDriveRoomStore,
	JsonlRoomEventLog,
} from "./collaboration";
import {
	loadOrSeedDriveFacets,
	writeDriveFacetsFile,
} from "./drive-config/driveFacetsStore";

export type ClineDriveHostOptions = {
	/** Workspace / config parent for facets + room event log. */
	configParent: string;
	store?: DriveRoomStore;
	broadcastFn?: (event: DriveEvent) => void;
	promptRewriteFn?: (decision: PromptRewriteDecision) => Promise<void>;
};

export function createClineDriveHost(
	options: ClineDriveHostOptions,
): DriveHostPort {
	const store = options.store ?? getDriveRoomStore();
	if (!store.getEventLog()) {
		store.attachEventLog(new JsonlRoomEventLog(options.configParent));
	}

	const subscribers = new Set<(event: DriveEvent) => void>();
	const workBridges = new Set<(event: DriveEvent) => void>();

	const emit = (event: DriveEvent): void => {
		options.broadcastFn?.(event);
		for (const handler of subscribers) {
			handler(event);
		}
		if (event.track === "work") {
			for (const handler of workBridges) {
				handler(event);
			}
		}
	};

	const promptRewriteWired = options.promptRewriteFn != null;
	const capabilities = {
		...CLINE_HOST_CAPABILITIES,
		promptRewrite: promptRewriteWired,
	};

	return {
		capabilities,
		async resolveKnownAgents() {
			return [];
		},
		async readDurableFacets(workspaceRoot: string) {
			return loadOrSeedDriveFacets({ configParent: workspaceRoot });
		},
		async writeDurableFacets(workspaceRoot: string, next: unknown) {
			const facets = parseDriveFacetValues(next);
			writeDriveFacetsFile(workspaceRoot, facets);
		},
		async commitRoomOp(op: RoomOp): Promise<RoomSnapshot> {
			switch (op.type) {
				case "create": {
					store.create(op.roomId);
					return store.getOrThrow(op.roomId);
				}
				case "join": {
					const roomId = firstRoomId(store);
					const result = store.join({
						roomId,
						participant: op.participant,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "leave": {
					const roomId = findRoomForParticipant(store, op.participantId);
					const result = store.leave({
						roomId,
						participantId: op.participantId,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "setAddress": {
					// Address is applied via control.address when event exists; for now
					// return current snapshot of the only room if present.
					const roomId = firstRoomId(store);
					return store.getOrThrow(roomId);
				}
				case "setStage": {
					const roomId = firstRoomId(store);
					const result = store.setStage({
						roomId,
						sharer: op.sharer,
						pin: op.pin,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "setMode": {
					const roomId = firstRoomId(store);
					const result = store.setMode({
						roomId,
						subMode: op.subMode,
						driveActive: op.driveActive,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "raiseHand": {
					const roomId = firstRoomId(store);
					const result = store.raiseHand({
						roomId,
						participantId: op.participantId,
						raised: op.raised,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "mute": {
					const roomId = firstRoomId(store);
					const result = store.mute({
						roomId,
						participantId: op.participantId,
						muted: op.muted,
					});
					emit(result.event);
					return result.snapshot;
				}
				default: {
					const _never: never = op;
					return _never;
				}
			}
		},
		async broadcast(event: DriveEvent) {
			emit(event);
		},
		subscribe(handler: (event: DriveEvent) => void) {
			subscribers.add(handler);
			return () => {
				subscribers.delete(handler);
			};
		},
		bridgeWorkEvents(handler: (event: DriveEvent) => void) {
			workBridges.add(handler);
			return () => {
				workBridges.delete(handler);
			};
		},
		async applyPromptRewrite(decision: PromptRewriteDecision) {
			if (!promptRewriteWired || !options.promptRewriteFn) {
				throw new Error(
					"promptRewrite not advertised on ClineDriveHost (wire promptRewriteFn to enable)",
				);
			}
			await options.promptRewriteFn(decision);
		},
	};
}

function firstRoomId(store: DriveRoomStore): string {
	const id = store.rooms.keys().next().value;
	if (!id) {
		throw new Error("room_not_found:empty");
	}
	return id;
}

function findRoomForParticipant(
	store: DriveRoomStore,
	participantId: string,
): string {
	for (const [roomId, snap] of store.rooms) {
		if (snap.participants.some((p) => p.id === participantId)) {
			return roomId;
		}
	}
	throw new Error(`room_not_found:participant:${participantId}`);
}
