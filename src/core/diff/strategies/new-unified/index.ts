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
					// Trim excess context, keeping only MAX_CONTEXT_LINES before/after changes
					const changes = currentHunk.changes
					let startIdx = 0
					let endIdx = changes.length - 1

					// Find first non-context line
					for (let j = 0; j < changes.length; j++) {
						if (changes[j].type !== "context") {
							startIdx = Math.max(0, j - MAX_CONTEXT_LINES)
							break
						}
					}

					// Find last non-context line
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

			// Extract the complete indentation for each line
			const content = line.slice(1) // Remove the diff marker
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
				// Assume is a context line and add a space if it's empty
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
			return { success: false, error: "No hunks found in diff" }
		}

		for (const hunk of parsedDiff.hunks) {
			const contextStr = prepareSearchString(hunk.changes)
			const { index: matchPosition, confidence } = findBestMatch(contextStr, result)

			const editResult = await applyEdit(hunk, result, matchPosition, confidence, '')
			if (editResult.confidence > MIN_CONFIDENCE) {
				result = editResult.result
			} else {
				return { success: false, error: `Failed to apply edit using ${editResult.strategy} strategy` }
			}
		}

		return { success: true, content: result.join("\n") }
	}
}
