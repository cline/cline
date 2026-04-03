// Checkpoints have been removed. Stub type for compilation compatibility.

export class CheckpointTracker {
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	static async create(..._args: any[]): Promise<CheckpointTracker> {
		return new CheckpointTracker()
	}
	async commit(_message?: string): Promise<string | undefined> {
		return undefined
	}
	async getDiffFromCheckpoint(_commitHash: string): Promise<string> {
		return ""
	}
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	async getDiffSet(..._args: any[]): Promise<any[]> {
		return []
	}
	// biome-ignore lint/suspicious/noEmptyBlockStatements: stub
	async restoreCheckpoint(_commitHash: string): Promise<void> {}
	getShadowGitConfigWorkTree(): string | undefined {
		return undefined
	}
	// biome-ignore lint/suspicious/noEmptyBlockStatements: stub
	dispose(): void {}
}
