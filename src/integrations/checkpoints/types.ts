// Checkpoints have been removed. Stub types for compilation compatibility.

export interface ICheckpointManager {
	commit(message?: string): Promise<string | undefined>
	getDiffFromCheckpoint(commitHash: string): Promise<string>
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	restoreCheckpoint(...args: any[]): Promise<void>
	dispose(): void
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	saveCheckpoint(...args: any[]): Promise<any>
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	presentMultifileDiff(...args: any[]): Promise<any>
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	initialize(...args: any[]): Promise<void>
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	doesLatestTaskCompletionHaveNewChanges(...args: any[]): Promise<boolean>
}
