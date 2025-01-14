import { Diff, Hunk } from "./types"
import { findBestMatch, prepareSearchString } from "./search-strategies"
import { applyEdit } from "./edit-strategies"
import { DiffResult, DiffStrategy } from "../../types"

export class NewUnifiedDiffStrategy implements DiffStrategy {
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
		return `# apply_diff Tool Rules:

Generate a unified diff similar to what "diff -U0" would produce. 

The first two lines must include the file paths, starting with "---" for the original file and "+++" for the updated file. Do not include timestamps with the file paths.

Each hunk of changes must start with a line containing only "@@ ... @@". Do not include line numbers or ranges in the "@@ ... @@" lines. These are not necessary for the user's patch tool.

Your output must be a correct, clean patch that applies successfully against the current file contents. Mark all lines that need to be removed or changed with "-". Mark all new or modified lines with "+". Ensure you include all necessary changes; missing or unmarked lines will result in a broken patch.

Indentation matters! Make sure to preserve the exact indentation of both removed and added lines.

Start a new hunk for each section of the file that requires changes. However, include only the hunks that contain actual changes. If a hunk consists entirely of unchanged lines, skip it.

Group related changes together in the same hunk whenever possible. Output hunks in whatever logical order makes the most sense.

When editing a function, method, loop, or similar code block, replace the *entire* block in one hunk. Use "-" lines to delete the existing block and "+" lines to add the updated block. This ensures accuracy in your diffs.

If you need to move code within a file, create two hunks: one to delete the code from its original location and another to insert it at the new location.

To create a new file, show a diff from "--- /dev/null" to "+++ path/to/new/file.ext".

Format Requirements:

\`\`\`diff
--- mathweb/flask/app.py
+++ mathweb/flask/app.py
@@ ... @@
-class MathWeb:
+import sympy

+
+class MathWeb:
@@ ... @@
-def is_prime(x):
-    if x < 2:
-        return False
-    for i in range(2, int(math.sqrt(x)) + 1):
-        if x % i == 0:
-            return False
-    return True
@@ ... @@
-@app.route('/prime/<int:n>')
-def nth_prime(n):
-    count = 0
-    num = 1
-    while count < n:
-        num += 1
-        if is_prime(num):
-            count += 1
-    return str(num)
+@app.route('/prime/<int:n>')
+def nth_prime(n):
+    count = 0
+    num = 1
+    while count < n:
+        num += 1
+        if sympy.isprime(num):
+            count += 1
+    return str(num)
\`\`\`

Be precise, consistent, and follow these rules carefully to generate correct diffs!

Parameters:
- path: (required) The path of the file to apply the diff to (relative to the current working directory ${cwd})
- diff: (required) The diff content in unified format to apply to the file.

Usage:
<apply_diff>
<path>File path here</path>
<diff>
Your diff here
</diff>
</apply_diff>`
	}

	async applyDiff(
		originalContent: string,
		diffContent: string,
		startLine?: number,
		endLine?: number
	): Promise<DiffResult> {
		const MIN_CONFIDENCE = 0.9
		const parsedDiff = this.parseUnifiedDiff(diffContent)
		const originalLines = originalContent.split("\n")
		let result = [...originalLines]

		if (!parsedDiff.hunks.length) {
			return {
				success: false,
				error: "No hunks found in diff. Please ensure your diff includes actual changes and follows the unified diff format."
			}
		}

		for (const hunk of parsedDiff.hunks) {
			const contextStr = prepareSearchString(hunk.changes)
			const { index: matchPosition, confidence, strategy } = findBestMatch(contextStr, result)

			const editResult = await applyEdit(hunk, result, matchPosition, confidence, '')
			if (editResult.confidence > MIN_CONFIDENCE) {
				result = editResult.result
			} else {
				// Determine if the failure is due to search or edit
				if (confidence < MIN_CONFIDENCE) {
					// Search failure - likely due to context not matching
					const contextLines = hunk.changes.filter(c => c.type === "context").length
					const totalLines = hunk.changes.length
					const contextRatio = contextLines / totalLines

					let errorMsg = `Failed to find a matching location in the file (${Math.floor(confidence * 100)}% confidence, needs ${Math.floor(MIN_CONFIDENCE * 100)}%)\n\n`
					errorMsg += "Debug Info:\n"
					errorMsg += `- Search Strategy Used: ${strategy}\n`
					errorMsg += `- Context Lines: ${contextLines} out of ${totalLines} total lines (${Math.floor(contextRatio * 100)}%)\n`
					
					if (contextRatio < 0.2) {
						errorMsg += "\nPossible Issues:\n"
						errorMsg += "- Not enough context lines to uniquely identify the location\n"
						errorMsg += "- Add a few more lines of unchanged code around your changes\n"
					} else if (contextRatio > 0.5) {
						errorMsg += "\nPossible Issues:\n"
						errorMsg += "- Too many context lines may reduce search accuracy\n"
						errorMsg += "- Try to keep only 2-3 lines of context before and after changes\n"
					}

					if (startLine && endLine) {
						errorMsg += `\nSearch Range: lines ${startLine}-${endLine}\n`
					}

					return { success: false, error: errorMsg }
				} else {
					// Edit failure - likely due to content mismatch
					let errorMsg = `Failed to apply the edit using ${editResult.strategy} strategy (${Math.floor(editResult.confidence * 100)}% confidence)\n\n`
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
		}

		return { success: true, content: result.join("\n") }
	}
}
