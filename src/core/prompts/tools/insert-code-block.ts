import { ToolArgs } from "./types"

export function getInsertCodeBlockDescription(args: ToolArgs): string {
	return `## insert_code_block
Description: Inserts code blocks at specific line positions in a file. This is the primary tool for adding new code (functions/methods/classes, imports, attributes etc.) as it allows for precise insertions without overwriting existing content. The tool uses an efficient line-based insertion system that maintains file integrity and proper ordering of multiple insertions. Beware to use the proper indentation. This tool is the preferred way to add new code to files.
Parameters:
- path: (required) The path of the file to insert code into (relative to the current working directory ${args.cwd.toPosix()})
- operations: (required) A JSON array of insertion operations. Each operation is an object with:
    * start_line: (required) The line number where the code block should be inserted.  The content currently at that line will end up below the inserted code block.
    * content: (required) The code block to insert at the specified position. IMPORTANT NOTE: If the content is a single line, it can be a string. If it's a multi-line content, it should be a string with newline characters (\n) for line breaks.
Usage:
<insert_code_block>
<path>File path here</path>
<operations>[
  {
    "start_line": 10,
    "content": "Your code block here"
  }
]</operations>
</insert_code_block>
Example: Insert a new function and its import statement
<insert_code_block>
<path>src/app.ts</path>
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
</insert_code_block>`
}
