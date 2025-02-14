import { CommitResult } from "simple-git"

export type CheckpointResult = Partial<CommitResult> & Pick<CommitResult, "commit">

export type CheckpointDiff = {
	paths: {
		relative: string
		absolute: string
	}
	content: {
		before: string
		after: string
	}
}

export type CheckpointStrategy = "local" | "shadow"

export interface CheckpointService {
	saveCheckpoint(message: string): Promise<CheckpointResult | undefined>
	restoreCheckpoint(commit: string): Promise<void>
	getDiff(range: { from?: string; to?: string }): Promise<CheckpointDiff[]>
	workspaceDir: string
	baseHash?: string
	strategy: CheckpointStrategy
	version: number
}

export interface CheckpointServiceOptions {
	taskId: string
	workspaceDir: string
	log?: (message: string) => void
}
