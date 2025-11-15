import * as diff from "diff"

export class DiffUtils {
	/**
	 * Creates a focused diff showing the changes with context
	 * @param filename Name of the file being modified
	 * @param oldContent Original content of the file
	 * @param newContent New content after changes
	 * @param contextLines Number of lines of context to show before and after changes (default: 5)
	 * @returns Formatted diff string with context
	 */
	static createFocusedDiff(
		filename: string,
		oldContent: string = "",
		newContent: string = "",
		contextLines: number = 5,
	): string {
		const changes = diff.diffLines(oldContent, newContent, { newlineIsToken: true })

		let result = `--- ${filename}\n+++ ${filename}\n`
		let currentLine = 1
		let inChangeBlock = false
		let contextBuffer: string[] = []
		let changeLines: string[] = []

		const flushContextBuffer = () => {
			if (contextBuffer.length > 0) {
				result += contextBuffer.join("\n") + "\n"
				contextBuffer = []
			}
		}

		const addContextSeparator = () => {
			if (result && !result.endsWith("...\n")) {
				result += "...\n"
			}
		}

		for (const part of changes) {
			const lines = part.value.split("\n")
			// Remove empty string that split adds when there's a trailing newline
			if (lines[lines.length - 1] === "") {
				lines.pop()
			}

			if (part.added || part.removed) {
				if (!inChangeBlock) {
					inChangeBlock = true
					// Add context before the change
					flushContextBuffer()
					addContextSeparator()
				}

				const prefix = part.added ? "+" : "-"
				changeLines.push(...lines.map((line) => (line ? `${prefix} ${line}` : prefix)))
			} else {
				if (inChangeBlock) {
					// We're transitioning from changed lines to unchanged lines
					inChangeBlock = false

					// Add the changed lines
					result += changeLines.join("\n") + "\n"
					changeLines = []

					// Add context after the change
					const contextAfter = lines.slice(0, contextLines)
					if (contextAfter.length > 0) {
						result += contextAfter.map((line) => `  ${line}`).join("\n") + "\n"
					}
					if (lines.length > contextLines) {
						result += "...\n"
					}
				} else {
					// We're in an unchanged section, buffer the context
					if (contextBuffer.length < contextLines) {
						// Add to buffer if we're still collecting context
						contextBuffer.push(...lines.map((line) => `  ${line}`))
						// Keep only the last contextLines
						if (contextBuffer.length > contextLines) {
							contextBuffer = contextBuffer.slice(-contextLines)
							if (contextBuffer[0] !== "...\n") {
								contextBuffer.unshift("...\n")
							}
						}
					}
				}
				currentLine += lines.length
			}
		}

		// Handle any remaining changed lines at the end
		if (changeLines.length > 0) {
			flushContextBuffer()
			addContextSeparator()
			result += changeLines.join("\n") + "\n"
		}

		return result
	}
}
