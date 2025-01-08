import { Diff, Hunk } from "./types"
import { findBestMatch, prepareSearchString } from "./search-strategies"
import { applyEdit } from "./edit-strategies"
import { DiffResult, DiffStrategy } from "../../types"

export class NewUnifiedDiffStrategy implements DiffStrategy {
	private parseUnifiedDiff(diff: string): Diff {
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
				if (currentHunk) {
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
			}
		}

		if (currentHunk && currentHunk.changes.length > 0) {
			hunks.push(currentHunk)
		}

		return { hunks }
	}

	getToolDescription(cwd: string): string {
		return `## apply_diff
Description: Apply a unified diff to a file at the specified path. This tool is useful when you need to make specific modifications to a file based on a set of changes provided in unified diff format (diff -U0).

Make sure you include the first 2 lines with the file paths.
Don't include timestamps with the file paths.

Start each hunk of changes with a \`@@ ... @@\` line.
Don't include line numbers like \`diff -U0\` does.
The user's patch tool doesn't need them.

Indentation matters in the diffs!

Start a new hunk for each section of the file that needs changes.

Only output hunks that specify changes with \`+\` or \`-\` lines.
Skip any hunks that are entirely unchanging \` \` lines.

The user's patch tool needs CORRECT patches that apply cleanly against the current contents of the file!
Think carefully and make sure you include and mark all lines that need to be removed or changed as \`-\` lines.
Make sure you mark all new or modified lines with \`+\`.
Don't leave out any lines or the diff patch won't apply correctly.

Output hunks in whatever order makes the most sense.
Hunks don't need to be in any particular order.

The hunks do not need line numbers.

When editing a function, method, loop, etc use a hunk to replace the *entire* code block.
Delete the entire existing version with \`-\` lines and then add a new, updated version with \`+\` lines.
This will help you generate correct code and correct diffs.

To move code within a file, use 2 hunks: 1 to delete it from its current location, 1 to insert it in the new location.

Parameters:
- path: (required) The path of the file to apply the diff to (relative to the current working directory ${cwd})
- diff: (required) The diff content in unified format to apply to the file.

For each file that needs to be changed, write out the changes similar to a unified diff like \`diff -U0\` would produce.


Example:
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
		let result = originalContent.split("\n")

		for (const hunk of parsedDiff.hunks) {
			const contextStr = prepareSearchString(hunk.changes)
			const { index: matchPosition, confidence } = findBestMatch(contextStr, result)

			const editResult = await applyEdit(hunk, result, matchPosition, confidence)
			if (editResult.confidence > MIN_CONFIDENCE) {
				result = editResult.result
			} else {
				return { success: false, error: `Failed to apply edit using ${editResult.strategy} strategy` }
			}
		}

		return { success: true, content: result.join("\n") }
	}
}
