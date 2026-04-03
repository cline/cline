// Checkpoints have been removed. Stub for compilation compatibility.
import type { ICheckpointManager } from "./types"

// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
export function shouldUseMultiRoot(..._args: any[]): boolean {
	return false
}

// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
export function buildCheckpointManager(..._args: any[]): ICheckpointManager | undefined {
	return undefined
}
