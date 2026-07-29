import type { StatusSummary, StatusUpdate, TeamRuntimeState } from "@cline/shared";

/** Snapshot shape shared by live hub and demo status adapters. */
export type StatusSnapshot = {
	updates: StatusUpdate[];
	summary: StatusSummary | null;
	teams: TeamRuntimeState[];
};

/** Port for loading a Status Hub snapshot (live or demo). */
export interface StatusSnapshotSource {
	load(): Promise<StatusSnapshot>;
}
