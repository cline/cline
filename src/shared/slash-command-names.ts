const WORKFLOW_EXTENSION_REGEX = /\.(md|txt)$/i

/**
 * Converts a workflow filename/path into a clean slash command name.
 * Example: "pr-review.md" -> "pr-review"
 */
export function toWorkflowCommandName(input: string): string {
	const fileName = input.replace(/^.*[/\\]/, "")
	return fileName.replace(WORKFLOW_EXTENSION_REGEX, "")
}

/**
 * Returns all accepted command aliases for a workflow.
 * First alias is the normalized display command name.
 */
export function getWorkflowCommandAliases(fileName: string): string[] {
	const normalized = toWorkflowCommandName(fileName)
	return normalized === fileName ? [fileName] : [normalized, fileName]
}
