export type ModeToggleDraftAction = "clear" | "restore" | "keep"

export function getModeToggleDraftAction(input: {
	consumed: boolean
	currentText: string
	submittedText: string
}): ModeToggleDraftAction {
	if (input.consumed) {
		return input.currentText === input.submittedText ? "clear" : "keep"
	}

	return input.currentText.length === 0 && input.submittedText.length > 0 ? "restore" : "keep"
}
