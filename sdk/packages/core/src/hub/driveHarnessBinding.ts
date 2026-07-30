/**
 * Hub-side DriveHarness binding — single writer via createClineDriveHost.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { createDriveHarness, type DriveHarness } from "@cline/drive";
import type { DriveEvent, RoomSnapshot } from "@cline/shared";
import { createClineDriveHost } from "./clineDriveHost";
import {
	type DriveRoomStore,
	getDriveRoomStore,
	JsonlRoomEventLog,
} from "./collaboration";
import { resolvePackFromRegistry } from "./drive-config/driveRegistryStore";

export type HubRoomCommit = {
	event: DriveEvent;
	snapshot: RoomSnapshot;
	seq: number;
};

type HubHarnessBinding = {
	harness: DriveHarness;
	configParent: string;
};

type HubCommitCapture = {
	commits: HubRoomCommit[];
};

/** Per-async-context commit buffer so concurrent room ops cannot steal each other's commits. */
const hubCommitCapture = new AsyncLocalStorage<HubCommitCapture>();

const bindings = new WeakMap<DriveRoomStore, HubHarnessBinding>();

/**
 * DriveHarness over the process-wide room store (and optional config parent).
 * Room commits during `captureHubRoomCommit` are recorded for hub publishRoomEvent.
 * `resolveRosterPack` reads durable `registry.v1.json` under configParent.
 */
export function getHubDriveHarness(input?: {
	store?: DriveRoomStore;
	configParent?: string;
}): HubHarnessBinding {
	const store = input?.store ?? getDriveRoomStore();
	const existing = bindings.get(store);
	if (existing) {
		const nextParent = input?.configParent?.trim();
		if (nextParent && nextParent !== existing.configParent) {
			existing.configParent = nextParent;
			// Keep durable room events aligned with registry resolution parent.
			// First bind may have attached under tmpdir() before workspaceRoot existed.
			store.attachEventLog(new JsonlRoomEventLog(nextParent));
		}
		return existing;
	}

	const binding: HubHarnessBinding = {
		harness: null as unknown as DriveHarness,
		configParent: input?.configParent?.trim() || tmpdir(),
	};

	const host = createClineDriveHost({
		configParent: binding.configParent,
		store,
		broadcastFn: (event) => {
			const capture = hubCommitCapture.getStore();
			if (!capture) {
				return;
			}
			const snapshot = store.get(event.roomId);
			if (!snapshot) {
				return;
			}
			capture.commits.push({
				event,
				snapshot,
				seq: store.lastSeq(event.roomId),
			});
		},
	});

	binding.harness = createDriveHarness({
		host,
		resolveRosterPack: (packId) =>
			resolvePackFromRegistry(binding.configParent, packId),
	});
	bindings.set(store, binding);
	return binding;
}

/**
 * Run a harness room op and return the last commit it produced.
 * Concurrent captures isolate commits via AsyncLocalStorage.
 */
export async function captureHubRoomCommit(
	store: DriveRoomStore,
	run: () => Promise<unknown>,
): Promise<HubRoomCommit | null> {
	getHubDriveHarness({ store });
	const box: HubCommitCapture = { commits: [] };
	await hubCommitCapture.run(box, run);
	return box.commits.at(-1) ?? null;
}
