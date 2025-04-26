export const LOCK_TEXT_SYMBOL = "\u{1F512}"

export class RooIgnoreController {
	rooIgnoreContent: string | undefined = undefined

	constructor(_cwd: string) {
		// No-op constructor
	}

	async initialize(): Promise<void> {
		// No-op initialization
		return Promise.resolve()
	}

	validateAccess(_filePath: string): boolean {
		// Default implementation: allow all access
		return true
	}

	validateCommand(_command: string): string | undefined {
		// Default implementation: allow all commands
		return undefined
	}

	filterPaths(paths: string[]): string[] {
		// Default implementation: allow all paths
		return paths
	}

	dispose(): void {
		// No-op dispose
	}

	getInstructions(): string | undefined {
		// Default implementation: no instructions
		return undefined
	}
}
