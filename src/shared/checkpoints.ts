export type CheckpointStorage = "task" | "workspace"

export const isCheckpointStorage = (value: string): value is CheckpointStorage => {
	return value === "task" || value === "workspace"
}
