import * as vscode from "vscode"

/**
 * Detects potential AI-generated code omissions in the given file content.
 * @param originalFileContent The original content of the file.
 * @param newFileContent The new content of the file to check.
 * @returns True if a potential omission is detected, false otherwise.
 */
function detectCodeOmission(originalFileContent: string, newFileContent: string): boolean {
	const originalLines = originalFileContent.split("\n")
	const newLines = newFileContent.split("\n")
	const omissionKeywords = ["remain", "remains", "unchanged", "rest", "previous", "existing", "..."]

	const commentPatterns = [
		/^\s*\/\//, // Single-line comment for most languages
		/^\s*#/, // Single-line comment for Python, Ruby, etc.
		/^\s*\/\*/, // Multi-line comment opening
		/^\s*{\s*\/\*/, // JSX comment opening
		/^\s*<!--/, // HTML comment opening
	]

	for (const line of newLines) {
		if (commentPatterns.some((pattern) => pattern.test(line))) {
			const words = line.toLowerCase().split(/\s+/)
			if (omissionKeywords.some((keyword) => words.includes(keyword))) {
				if (!originalLines.includes(line)) {
					return true
				}
			}
		}
	}

	return false
}

/**
 * Shows a warning in VSCode if a potential code omission is detected.
 * @param originalFileContent The original content of the file.
 * @param newFileContent The new content of the file to check.
 */
export function showOmissionWarning(originalFileContent: string, newFileContent: string): void {
	if (detectCodeOmission(originalFileContent, newFileContent)) {
		vscode.window
			.showWarningMessage(
				"Potential code truncation detected. This happens when the AI reaches its max output limit.",
				"Follow this guide to fix the issue"
			)
			.then((selection) => {
				if (selection === "Follow this guide to fix the issue") {
					vscode.env.openExternal(
						vscode.Uri.parse(
							"https://github.com/cline/cline/wiki/Troubleshooting-%E2%80%90-Cline-Deleting-Code-with-%22Rest-of-Code-Here%22-Comments"
						)
					)
				}
			})
	}
}
