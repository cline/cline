import { Diff, Hunk, Change } from "./types"
import { findBestMatch, prepareSearchString } from "./search-strategies"
import { applyEdit } from "./edit-strategies"
import { DiffResult, DiffStrategy } from "../../types"

export class NewUnifiedDiffStrategy implements DiffStrategy {
	private readonly confidenceThreshold: number

	constructor(confidenceThreshold: number = 1) {
		this.confidenceThreshold = Math.max(confidenceThreshold, 0.8)
	}

	private parseUnifiedDiff(diff: string): Diff {
		const MAX_CONTEXT_LINES = 6 // Number of context lines to keep before/after changes
		const lines = diff.split("\n")
		const hunks: Hunk[] = []
		let currentHunk: Hunk | null = null

		let i = 0
		while (i < lines.length && !lines[i].startsWith("@@")) {
			i++
		}

		for (; i < lines.length; i++) {
			const line = lines[i]

			if (line.startsWith("@@")) {
				if (
					currentHunk &&
					currentHunk.changes.length > 0 &&
					currentHunk.changes.some((change) => change.type === "add" || change.type === "remove")
				) {
					const changes = currentHunk.changes
					let startIdx = 0
					let endIdx = changes.length - 1

					for (let j = 0; j < changes.length; j++) {
						if (changes[j].type !== "context") {
							startIdx = Math.max(0, j - MAX_CONTEXT_LINES)
							break
						}
					}

					for (let j = changes.length - 1; j >= 0; j--) {
						if (changes[j].type !== "context") {
							endIdx = Math.min(changes.length - 1, j + MAX_CONTEXT_LINES)
							break
						}
					}

					currentHunk.changes = changes.slice(startIdx, endIdx + 1)
					hunks.push(currentHunk)
				}
				currentHunk = { changes: [] }
				continue
			}

			if (!currentHunk) {
				continue
			}

			const content = line.slice(1)
			const indentMatch = content.match(/^(\s*)/)
			const indent = indentMatch ? indentMatch[0] : ""
			const trimmedContent = content.slice(indent.length)

			if (line.startsWith(" ")) {
				currentHunk.changes.push({
					type: "context",
					content: trimmedContent,
					indent,
					originalLine: content,
				})
			} else if (line.startsWith("+")) {
				currentHunk.changes.push({
					type: "add",
					content: trimmedContent,
					indent,
					originalLine: content,
				})
			} else if (line.startsWith("-")) {
				currentHunk.changes.push({
					type: "remove",
					content: trimmedContent,
					indent,
					originalLine: content,
				})
			} else {
				const finalContent = trimmedContent ? " " + trimmedContent : " "
				currentHunk.changes.push({
					type: "context",
					content: finalContent,
					indent,
					originalLine: content,
				})
			}
		}

		if (
			currentHunk &&
			currentHunk.changes.length > 0 &&
			currentHunk.changes.some((change) => change.type === "add" || change.type === "remove")
		) {
			hunks.push(currentHunk)
		}

		return { hunks }
	}

	getToolDescription(cwd: string): string {
		return `# apply_diff Tool - Generate Precise Code Changes

Generate a unified diff that can be cleanly applied to modify code files.

## Step-by-Step Instructions:

1. Start with file headers:
   - First line: "--- {original_file_path}"
   - Second line: "+++ {new_file_path}"

2. For each change section:
   - Begin with "@@ ... @@" separator line without line numbers
   - Include 2-3 lines of context before and after changes
   - Mark removed lines with "-"
   - Mark added lines with "+"
   - Preserve exact indentation

3. Group related changes:
   - Keep related modifications in the same hunk
   - Start new hunks for logically separate changes
   - When modifying functions/methods, include the entire block

## Requirements:

1. MUST include exact indentation
2. MUST include sufficient context for unique matching
3. MUST group related changes together
4. MUST use proper unified diff format
5. MUST NOT include timestamps in file headers
6. MUST NOT include line numbers in the @@ header

## Examples:

✅ Good diff (follows all requirements):
\`\`\`diff
--- src/utils.ts
+++ src/utils.ts
@@ ... @@
    def calculate_total(items):
-      total = 0
-      for item in items:
-          total += item.price
+      return sum(item.price for item in items)
\`\`\`

❌ Bad diff (violates requirements #1 and #2):
\`\`\`diff
--- src/utils.ts
+++ src/utils.ts
@@ ... @@
-total = 0
-for item in items:
+return sum(item.price for item in items)
\`\`\`

Parameters:
- path: (required) File path relative to ${cwd}
- diff: (required) Unified diff content

Usage:
<apply_diff>
<path>path/to/file.ext</path>
<diff>
Your diff here
</diff>
</apply_diff>`
	}

	// Helper function to split a hunk into smaller hunks based on contiguous changes
	private splitHunk(hunk: Hunk): Hunk[] {
		const result: Hunk[] = []
		let currentHunk: Hunk | null = null
		let contextBefore: Change[] = []
		let contextAfter: Change[] = []
		const MAX_CONTEXT_LINES = 3 // Keep 3 lines of context before/after changes

		for (let i = 0; i < hunk.changes.length; i++) {
			const change = hunk.changes[i]

			if (change.type === "context") {
				if (!currentHunk) {
					contextBefore.push(change)
					if (contextBefore.length > MAX_CONTEXT_LINES) {
						contextBefore.shift()
					}
				} else {
					contextAfter.push(change)
					if (contextAfter.length > MAX_CONTEXT_LINES) {
						// We've collected enough context after changes, create a new hunk
						currentHunk.changes.push(...contextAfter)
						result.push(currentHunk)
						currentHunk = null
						// Keep the last few context lines for the next hunk
						contextBefore = contextAfter
						contextAfter = []
					}
				}
			} else {
				if (!currentHunk) {
					currentHunk = { changes: [...contextBefore] }
					contextAfter = []
				} else if (contextAfter.length > 0) {
					// Add accumulated context to current hunk
					currentHunk.changes.push(...contextAfter)
					contextAfter = []
				}
				currentHunk.changes.push(change)
			}
		}

		// Add any remaining changes
		if (currentHunk) {
			if (contextAfter.length > 0) {
				currentHunk.changes.push(...contextAfter)
			}
			result.push(currentHunk)
		}

		return result
	}

	async applyDiff(
		originalContent: string,
		diffContent: string,
		startLine?: number,
		endLine?: number
	): Promise<DiffResult> {
		const parsedDiff = this.parseUnifiedDiff(diffContent)
		const originalLines = originalContent.split("\n")
		let result = [...originalLines]

		if (!parsedDiff.hunks.length) {
			return {
				success: false,
				error: "No hunks found in diff. Please ensure your diff includes actual changes and follows the unified diff format.",
			}
		}

		for (const hunk of parsedDiff.hunks) {
			const contextStr = prepareSearchString(hunk.changes)
			const {
				index: matchPosition,
				confidence,
				strategy,
			} = findBestMatch(contextStr, result, 0, this.confidenceThreshold)

			if (confidence < this.confidenceThreshold) {
				console.log("Full hunk application failed, trying sub-hunks strategy")
				// Try splitting the hunk into smaller hunks
				const subHunks = this.splitHunk(hunk)
				let subHunkSuccess = true
				let subHunkResult = [...result]

				for (const subHunk of subHunks) {
					const subContextStr = prepareSearchString(subHunk.changes)
					const subSearchResult = findBestMatch(subContextStr, subHunkResult, 0, this.confidenceThreshold)

					if (subSearchResult.confidence >= this.confidenceThreshold) {
						const subEditResult = await applyEdit(
							subHunk,
							subHunkResult,
							subSearchResult.index,
							subSearchResult.confidence,
							this.confidenceThreshold
						)
						if (subEditResult.confidence >= this.confidenceThreshold) {
							subHunkResult = subEditResult.result
							continue
						}
					}
					subHunkSuccess = false
					break
				}

				if (subHunkSuccess) {
					result = subHunkResult
					continue
				}

				// If sub-hunks also failed, return the original error
				const contextLines = hunk.changes.filter((c) => c.type === "context").length
				const totalLines = hunk.changes.length
				const contextRatio = contextLines / totalLines

				let errorMsg = `Failed to find a matching location in the file (${Math.floor(
					confidence * 100
				)}% confidence, needs ${Math.floor(this.confidenceThreshold * 100)}%)\n\n`
				errorMsg += "Debug Info:\n"
				errorMsg += `- Search Strategy Used: ${strategy}\n`
				errorMsg += `- Context Lines: ${contextLines} out of ${totalLines} total lines (${Math.floor(
					contextRatio * 100
				)}%)\n`
				errorMsg += `- Attempted to split into ${subHunks.length} sub-hunks but still failed\n`

				if (contextRatio < 0.2) {
					errorMsg += "\nPossible Issues:\n"
					errorMsg += "- Not enough context lines to uniquely identify the location\n"
					errorMsg += "- Add a few more lines of unchanged code around your changes\n"
				} else if (contextRatio > 0.5) {
					errorMsg += "\nPossible Issues:\n"
					errorMsg += "- Too many context lines may reduce search accuracy\n"
					errorMsg += "- Try to keep only 2-3 lines of context before and after changes\n"
				} else {
					errorMsg += "\nPossible Issues:\n"
					errorMsg += "- The diff may be targeting a different version of the file\n"
					errorMsg +=
						"- There may be too many changes in a single hunk, try splitting the changes into multiple hunks\n"
				}

				if (startLine && endLine) {
					errorMsg += `\nSearch Range: lines ${startLine}-${endLine}\n`
				}

				return { success: false, error: errorMsg }
			}

			const editResult = await applyEdit(hunk, result, matchPosition, confidence, this.confidenceThreshold)
			if (editResult.confidence >= this.confidenceThreshold) {
				result = editResult.result
			} else {
				// Edit failure - likely due to content mismatch
				let errorMsg = `Failed to apply the edit using ${editResult.strategy} strategy (${Math.floor(
					editResult.confidence * 100
				)}% confidence)\n\n`
				errorMsg += "Debug Info:\n"
				errorMsg += "- The location was found but the content didn't match exactly\n"
				errorMsg += "- This usually means the file has been modified since the diff was created\n"
				errorMsg += "- Or the diff may be targeting a different version of the file\n"
				errorMsg += "\nPossible Solutions:\n"
				errorMsg += "1. Refresh your view of the file and create a new diff\n"
				errorMsg += "2. Double-check that the removed lines (-) match the current file content\n"
				errorMsg += "3. Ensure your diff targets the correct version of the file"

				return { success: false, error: errorMsg }
			}
		}

		return { success: true, content: result.join("\n") }
	}
}
