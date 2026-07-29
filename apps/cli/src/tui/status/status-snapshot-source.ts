import type { StatusSummary, StatusUpdate, TeamRuntimeState } from "@cline/shared";

export type StatusSnapshot = {
	updates: StatusUpdate[];
	summary: StatusSummary | null;
	teams: TeamRuntimeState[];
};

export interface StatusSnapshotSource {
	load(): Promise<StatusSnapshot>;
}

export type StatusViewBootstrap = {
	initialLens?: "board" | "dependency-map";
	autoOpen?: boolean;
	/** Optional subtitle when a demo/fallback adapter is active — set by composition, not by reading env in the view */
	banner?: string;
};
