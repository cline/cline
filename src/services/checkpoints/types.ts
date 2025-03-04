import EventEmitter from "events"
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

export interface CheckpointService {
	saveCheckpoint(message: string): Promise<CheckpointResult | undefined>
	restoreCheckpoint(commit: string): Promise<void>
	getDiff(range: { from?: string; to?: string }): Promise<CheckpointDiff[]>
	workspaceDir: string
	baseHash?: string
	version: number
}

export interface CheckpointServiceOptions {
	taskId: string
	workspaceDir: string
	log?: (message: string) => void
}

/**
 * EventEmitter
 */

export interface CheckpointEventMap {
	initialize: { type: "initialize"; workspaceDir: string; baseHash: string; created: boolean; duration: number }
	checkpoint: {
		type: "checkpoint"
		isFirst: boolean
		fromHash: string
		toHash: string
		duration: number
	}
	restore: { type: "restore"; commitHash: string; duration: number }
	error: { type: "error"; error: Error }
}

export class CheckpointEventEmitter extends EventEmitter {
	override emit<K extends keyof CheckpointEventMap>(event: K, data: CheckpointEventMap[K]): boolean {
		return super.emit(event, data)
	}

	override on<K extends keyof CheckpointEventMap>(event: K, listener: (data: CheckpointEventMap[K]) => void): this {
		return super.on(event, listener)
	}

	override off<K extends keyof CheckpointEventMap>(event: K, listener: (data: CheckpointEventMap[K]) => void): this {
		return super.off(event, listener)
	}

	override once<K extends keyof CheckpointEventMap>(event: K, listener: (data: CheckpointEventMap[K]) => void): this {
		return super.once(event, listener)
	}
}
