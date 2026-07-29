/**
 * Local Cline DriveHostPort adapter (ARD-0013).
 * Hub command handlers remain the primary entry; this adapter is the
 * commit/broadcast/facets boundary for conformance and future remote hosts.
 * Prefer createDriveHarness({ host }) from @cline/drive for room composition.
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
		async getRoom(roomId: string) {
			return store.get(roomId) ?? null;
		},
		async commitRoomOp(op: RoomOp): Promise<RoomSnapshot> {
			switch (op.type) {
				case "create": {
					store.create(op.roomId);
					return store.getOrThrow(op.roomId);
				}
				case "join": {
					const result = store.join({
						roomId: op.roomId,
						participant: op.participant,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "leave": {
					const result = store.leave({
						roomId: op.roomId,
						participantId: op.participantId,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "setAddress": {
					const result = store.setAddress({
						roomId: op.roomId,
						addressSet: op.addressSet,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "setStage": {
					const result = store.setStage({
						roomId: op.roomId,
						sharer: op.sharer,
						pin: op.pin,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "setMode": {
					const result = store.setMode({
						roomId: op.roomId,
						subMode: op.subMode,
						driveActive: op.driveActive,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "raiseHand": {
					const result = store.raiseHand({
						roomId: op.roomId,
						participantId: op.participantId,
						raised: op.raised,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "mute": {
					const result = store.mute({
						roomId: op.roomId,
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
