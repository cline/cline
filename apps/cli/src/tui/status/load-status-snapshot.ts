import { createHubStatusSnapshotSource } from "./hub-status-snapshot-source";
import type { StatusSnapshot } from "./status-snapshot-source";

/** @deprecated Prefer injecting a StatusSnapshotSource; kept for backwards compatibility. */
export async function loadTuiStatusSnapshot(options?: {
	address?: string;
}): Promise<StatusSnapshot> {
	return createHubStatusSnapshotSource(options).load();
}
