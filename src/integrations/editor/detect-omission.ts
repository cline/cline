/**
 * Detects potential AI-generated code omissions in the given file content.
 * @param originalFileContent The original content of the file.
 * @param newFileContent The new content of the file to check.
 * @param predictedLineCount The predicted number of lines in the new content.
 * @returns True if a potential omission is detected, false otherwise.
 */
export function detectCodeOmission(
	originalFileContent: string,
	newFileContent: string,
	predictedLineCount: number
): boolean {
	// Skip all checks if predictedLineCount is less than 100
	if (!predictedLineCount || predictedLineCount < 100) {
		return false
	}

	const actualLineCount = newFileContent.split("\n").length
	const lengthRatio = actualLineCount / predictedLineCount

	const originalLines = originalFileContent.split("\n")
	const newLines = newFileContent.split("\n")
	const omissionKeywords = ["remain", "remains", "unchanged", "rest", "previous", "existing", "content", "same", "..."]

	const commentPatterns = [
		/^\s*\/\//, // Single-line comment for most languages
		/^\s*#/, // Single-line comment for Python, Ruby, etc.
		/^\s*\/\*/, // Multi-line comment opening
		/^\s*{\s*\/\*/, // JSX comment opening
		/^\s*<!--/, // HTML comment opening
		/^\s*\[/, // Square bracket notation
	]

	// Consider comments as suspicious if they weren't in the original file
	// and contain omission keywords
	for (const line of newLines) {
		if (commentPatterns.some((pattern) => pattern.test(line))) {
			const words = line.toLowerCase().split(/\s+/)
			if (omissionKeywords.some((keyword) => words.includes(keyword))) {
				if (!originalLines.includes(line)) {
					// For files with 100+ lines, only flag if content is more than 20% shorter
					if (lengthRatio <= 0.80) {
						return true
					}
				}
			}
		}
	}

	return false
}