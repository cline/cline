export function shouldClearModeToggleDraft(input: { consumed: boolean; currentText: string; submittedText: string }): boolean {
	return input.consumed && input.currentText === input.submittedText
}

export function shouldRestoreModeToggleDraft(input: { consumed: boolean; currentText: string; submittedText: string }): boolean {
	return !input.consumed && input.currentText.length === 0 && input.submittedText.length > 0
}
