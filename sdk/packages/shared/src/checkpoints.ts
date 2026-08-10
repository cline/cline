export interface CheckpointEntry {
	ref: string;
	createdAt: number;
	runCount: number;
	kind?: "stash" | "commit";
}

export interface CheckpointMetadata {
	latest: CheckpointEntry;
	history: CheckpointEntry[];
}
