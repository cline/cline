import { ToolArgs } from "./types"

export function getInsertContentDescription(args: ToolArgs): string {
	return `## insert_content
Description: Insert new content at a specific line position in a file.

Parameters:
- path: (required) File path relative to workspace directory ${args.cwd.toPosix()}
- line: (required) Line number where content will be inserted (1-based)
	      Use 0 to append at end of file
	      Use any positive number to insert before that line
- content: (required) The content to insert at the specified line

Example for inserting imports at start of file:
<insert_content>
<path>src/utils.ts</path>
<line>1</line>
<content>
// Add imports at start of file
import { sum } from './math';
</content>
</insert_content>

Example for appending to the end of file:
<insert_content>
<path>src/utils.ts</path>
<line>0</line>
<content>
// This is the end of the file
</content>
</insert_content>
`
}
