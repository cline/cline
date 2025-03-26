import { CheckpointStorage } from "../exports/roo-code"

export type { CheckpointStorage }

export const isCheckpointStorage = (value: string): value is CheckpointStorage => {
	return value === "task" || value === "workspace"
}
