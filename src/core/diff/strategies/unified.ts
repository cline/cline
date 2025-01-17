import { applyPatch } from "diff"
import { DiffStrategy, DiffResult } from "../types"

export class UnifiedDiffStrategy implements DiffStrategy {
    getToolDescription(args: { cwd: string; toolOptions?: { [key: string]: string } }): string {
        return `## apply_diff
Description: Apply a unified diff to a file at the specified path. This tool is useful when you need to make specific modifications to a file based on a set of changes provided in unified diff format (diff -U3).

Parameters:
- path: (required) The path of the file to apply the diff to (relative to the current working directory ${args.cwd})
- diff: (required) The diff content in unified format to apply to the file.

Format Requirements:

1. Header (REQUIRED):
    \`\`\`
    --- path/to/original/file
    +++ path/to/modified/file
    \`\`\`
    - Must include both lines exactly as shown
    - Use actual file paths
    - NO timestamps after paths

2. Hunks:
    \`\`\`
    @@ -lineStart,lineCount +lineStart,lineCount @@
    -removed line
    +added line
    \`\`\`
    - Each hunk starts with @@ showing line numbers for changes
    - Format: @@ -originalStart,originalCount +newStart,newCount @@
    - Use - for removed/changed lines
    - Use + for new/modified lines
    - Indentation must match exactly

Complete Example:

Original file (with line numbers):
\`\`\`
1 | import { Logger } from '../logger';
2 | 
3 | function calculateTotal(items: number[]): number {
4 |   return items.reduce((sum, item) => {
5 |     return sum + item;
6 |   }, 0);
7 | }
8 | 
9 | export { calculateTotal };
\`\`\`

After applying the diff, the file would look like:
\`\`\`
1 | import { Logger } from '../logger';
2 | 
3 | function calculateTotal(items: number[]): number {
4 |   const total = items.reduce((sum, item) => {
5 |     return sum + item * 1.1;  // Add 10% markup
6 |   }, 0);
7 |   return Math.round(total * 100) / 100;  // Round to 2 decimal places
8 | }
9 | 
10 | export { calculateTotal };
\`\`\`

Diff to modify the file:
\`\`\`
--- src/utils/helper.ts
+++ src/utils/helper.ts
@@ -1,9 +1,10 @@
 import { Logger } from '../logger';
 
 function calculateTotal(items: number[]): number {
-  return items.reduce((sum, item) => {
-    return sum + item;
+  const total = items.reduce((sum, item) => {
+    return sum + item * 1.1;  // Add 10% markup
   }, 0);
+  return Math.round(total * 100) / 100;  // Round to 2 decimal places
 }
 
 export { calculateTotal };
\`\`\`

Common Pitfalls:
1. Missing or incorrect header lines
2. Incorrect line numbers in @@ lines
3. Wrong indentation in changed lines
4. Incomplete context (missing lines that need changing)
5. Not marking all modified lines with - and +

Best Practices:
1. Replace entire code blocks:
    - Remove complete old version with - lines
    - Add complete new version with + lines
    - Include correct line numbers
2. Moving code requires two hunks:
    - First hunk: Remove from old location
    - Second hunk: Add to new location
3. One hunk per logical change
4. Verify line numbers match the line numbers you have in the file

Usage:
<apply_diff>
<path>File path here</path>
<diff>
Your diff here
</diff>
</apply_diff>`
    }

    async applyDiff(originalContent: string, diffContent: string): Promise<DiffResult> {
        try {
            const result = applyPatch(originalContent, diffContent)
            if (result === false) {
                return {
                    success: false,
                    error: "Failed to apply unified diff - patch rejected",
                    details: {
                        searchContent: diffContent
                    }
                }
            }
            return {
                success: true,
                content: result
            }
        } catch (error) {
            return {
                success: false,
                error: `Error applying unified diff: ${error.message}`,
                details: {
                    searchContent: diffContent
                }
            }
        }
    }
}
