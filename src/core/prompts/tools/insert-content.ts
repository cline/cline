import { ToolArgs } from "./types"

export function getInsertContentDescription(args: ToolArgs): string {
	return `## insert_content
Description: Inserts content at specific line positions in a file. This is the primary tool for adding new content and code (functions/methods/classes, imports, attributes etc.) as it allows for precise insertions without overwriting existing content. The tool uses an efficient line-based insertion system that maintains file integrity and proper ordering of multiple insertions. Beware to use the proper indentation. This tool is the preferred way to add new content and code to files.
Parameters:
- path: (required) The path of the file to insert content into (relative to the current workspace directory ${args.cwd.toPosix()})
- operations: (required) A JSON array of insertion operations. Each operation is an object with:
    * start_line: (required) The line number where the content should be inserted.  The content currently at that line will end up below the inserted content.
    * content: (required) The content to insert at the specified position. IMPORTANT NOTE: If the content is a single line, it can be a string. If it's a multi-line content, it should be a string with newline characters (\n) for line breaks. Make sure to include the correct indentation for the content.
Usage:
<insert_content>
<path>File path here</path>
<operations>[
  {
    "start_line": 10,
    "content": "Your content here"
  }
]</operations>
</insert_content>
Example: Insert a new function and its import statement
<insert_content>
<path>File path here</path>
<operations>[
  {
    "start_line": 1,
    "content": "import { sum } from './utils';"
  },
  {
    "start_line": 10,
    "content": "function calculateTotal(items: number[]): number {\n    return items.reduce((sum, item) => sum + item, 0);\n}"
  }
]</operations>
</insert_content>`
}
