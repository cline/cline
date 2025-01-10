import { Diff, Hunk } from "./types"
import { findBestMatch, prepareSearchString } from "./search-strategies"
import { applyEdit } from "./edit-strategies"
import { DiffResult, DiffStrategy } from "../../types"

export class NewUnifiedDiffStrategy implements DiffStrategy {
	private parseUnifiedDiff(diff: string): Diff {
    const MAX_CONTEXT_LINES = 6; // Number of context lines to keep before/after changes
    const lines = diff.split('\n');
    const hunks: Hunk[] = [];
    let currentHunk: Hunk | null = null;
    
    let i = 0;
    while (i < lines.length && !lines[i].startsWith('@@')) {
      i++;
    }
  
    for (; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('@@')) {
        if (currentHunk && currentHunk.changes.length > 0 && 
            currentHunk.changes.some(change => change.type === 'add' || change.type === 'remove')) {
          // Trim excess context, keeping only MAX_CONTEXT_LINES before/after changes
          const changes = currentHunk.changes;
          let startIdx = 0;
          let endIdx = changes.length - 1;
          
          // Find first non-context line
          for (let j = 0; j < changes.length; j++) {
            if (changes[j].type !== 'context') {
              startIdx = Math.max(0, j - MAX_CONTEXT_LINES);
              break;
            }
          }
          
          // Find last non-context line
          for (let j = changes.length - 1; j >= 0; j--) {
            if (changes[j].type !== 'context') {
              endIdx = Math.min(changes.length - 1, j + MAX_CONTEXT_LINES);
              break;
            }
          }
          
          currentHunk.changes = changes.slice(startIdx, endIdx + 1);
          hunks.push(currentHunk);
        }
        currentHunk = { changes: [] };
        continue;
      }
  
      if (!currentHunk) {continue};
  
      // Extract the complete indentation for each line
      const content = line.slice(1); // Remove the diff marker
      const indentMatch = content.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[0] : '';
      const trimmedContent = content.slice(indent.length);
  
      if (line.startsWith(' ')) {
        currentHunk.changes.push({
          type: 'context',
          content: trimmedContent,
          indent,
          originalLine: content
        });
      } else if (line.startsWith('+')) {
        currentHunk.changes.push({
          type: 'add',
          content: trimmedContent,
          indent,
          originalLine: content
        });
      } else if (line.startsWith('-')) {
        currentHunk.changes.push({
          type: 'remove',
          content: trimmedContent,
          indent,
          originalLine: content
        });
      }
    }
  
    if (currentHunk && currentHunk.changes.length > 0 && 
        currentHunk.changes.some(change => change.type === 'add' || change.type === 'remove')) {
      hunks.push(currentHunk);
    }
  
    return { hunks };
  }

	getToolDescription(cwd: string): string {
		return `## apply_diff

Description:
Apply a unified diff to a file at the specified path. This tool generates minimal, focused diffs that group related changes together.

Important: It is not necessary to include line numbers in the @@ lines! The patch tool does not use them.

Key Requirements:
1. Generate compact diffs with minimal context
   - Use reduced context similar to diff -U0
   - Only include hunks that contain actual changes (+ or - lines)
   - Skip hunks with only unchanged lines

2. Use high-level, logical grouping
   - When modifying code blocks (functions, methods, loops), replace the entire block in one hunk
   - Delete the complete existing block with \`-\` lines
   - Add the complete updated block with \`+\` lines
   - Group related changes together rather than creating many small hunks

3. Format requirements
   - Include file paths in the first 2 lines (without timestamps)
   - Each hunk must start with ONLY \`@@ ... @@\` (line numbers are not needed)
   - Preserve exact indentation
   - The @@ lines should be simple separators between hunks - Line numbers or line ranges should not be included

4. Common operations
   - To move code: Create one hunk to delete from original location, another to add at new location
   - To modify a block: Delete entire original block, then add entire new version
   - Order hunks in whatever logical sequence makes sense

Parameters:
- path: (required) File path relative to current working directory ${cwd}
- diff: (required) Unified format diff content to apply

The output must generate correct, clean patches that apply successfully against the current file contents. All changes must be properly marked with + (new/modified) or - (removed) lines.


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
    const originalLines = originalContent.split("\n")
		let result = [...originalLines]

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
