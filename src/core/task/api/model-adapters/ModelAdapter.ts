/**
 * Base model adapter interface for provider/model-specific quirks.
 * Keep it minimal for Step 1; real logic will be added in later phases.
 */
export interface ModelAdapter {
	idMatch(modelId: string): boolean
	adjustSystemPrompt(system: string): string
	preprocessDiff(diff: string): string
	preprocessCommand(command: string): string
	supportsImages(): boolean
}

/**
 * Default no-op adapter that preserves current behavior.
 */
export class DefaultModelAdapter implements ModelAdapter {
	idMatch(_modelId: string): boolean {
		return true
	}
	adjustSystemPrompt(system: string): string {
		return system
	}
	preprocessDiff(diff: string): string {
		return diff
	}
	preprocessCommand(command: string): string {
		return command
	}
	supportsImages(): boolean {
		return true
	}
}
