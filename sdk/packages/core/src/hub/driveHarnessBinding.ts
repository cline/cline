/**
 * Hub-side DriveHarness binding — single writer via createClineDriveHost.
 */

import { createDriveHarness, type DriveHarness } from "@cline/drive";
import type { DriveEvent, RoomSnapshot } from "@cline/shared";
import { tmpdir } from "node:os";
import { createClineDriveHost } from "./clineDriveHost";
import {
	type DriveRoomStore,
	getDriveRoomStore,
} from "./collaboration";

export type HubRoomCommit = {
	event: DriveEvent;
	snapshot: RoomSnapshot;
	seq: number;
};

type HubHarnessBinding = {
	harness: DriveHarness;
	lastCommit: HubRoomCommit | null;
};

const bindings = new WeakMap<DriveRoomStore, HubHarnessBinding>();

/**
 * DriveHarness over the process-wide room store (and optional config parent).
 * Room commits update `lastCommit` for hub publishRoomEvent.
 */
export function getHubDriveHarness(input?: {
	store?: DriveRoomStore;
	configParent?: string;
}): HubHarnessBinding {
	const store = input?.store ?? getDriveRoomStore();
	const existing = bindings.get(store);
	if (existing) {
		return existing;
	}

	const binding: HubHarnessBinding = {
		harness: null as unknown as DriveHarness,
		lastCommit: null,
	};

	const host = createClineDriveHost({
		configParent: input?.configParent?.trim() || tmpdir(),
		store,
		broadcastFn: (event) => {
			const snapshot = store.get(event.roomId);
			if (!snapshot) {
				return;
			}
			binding.lastCommit = {
				event,
				snapshot,
				seq: store.lastSeq(event.roomId),
			};
		},
	});

	binding.harness = createDriveHarness({ host });
	bindings.set(store, binding);
	return binding;
}

export function takeHubRoomCommit(store: DriveRoomStore = getDriveRoomStore()): HubRoomCommit | null {
	const binding = bindings.get(store);
	if (!binding?.lastCommit) {
		return null;
	}
	const commit = binding.lastCommit;
	binding.lastCommit = null;
	return commit;
}
