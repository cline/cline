// Focus chain has been removed. Stub class for compilation compatibility.

export class FocusChainManager {
	// biome-ignore lint/complexity/noUselessConstructor: stub needs to accept args
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	constructor(_deps: any) {}
	async setupFocusChainFileWatcher(): Promise<void> {}
	shouldIncludeFocusChainInstructions(): boolean {
		return false
	}
	generateFocusChainInstructions(): string {
		return ""
	}
	async updateFCListFromToolResponse(_taskProgress?: string): Promise<void> {}
	checkIncompleteProgressOnCompletion(_modelId: string, _provider: string): void {}
	dispose(): void {}
}
