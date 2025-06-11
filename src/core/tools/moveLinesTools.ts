import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"

const descriptionForAgent = (
	cwd: string,
) => `Request to move or copy lines between files. This tool allows you to extract lines from a source file and insert them at a specific location in a target file.

Usage:
- The source_path and target_path parameters must be relative paths to the current working directory: ${cwd.toPosix()}
- The operation parameter specifies whether to "move" (cut and paste) or "copy" (copy and paste) the lines
- Line numbers are 1-based (first line is line 1)
- For move operations, the lines will be removed from the source file after being inserted in the target file
- For copy operations, the lines will remain in the source file after being copied to the target file
- The target_line parameter specifies where to insert the lines (they will be inserted after this line number)
- Use target_line: 0 to insert at the beginning of the file`

export const moveLinesToolDefinition = (cwd: string): ToolDefinition => ({
	name: "move_lines",
	descriptionForAgent: descriptionForAgent(cwd),
	inputSchema: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				enum: ["move", "copy"],
				description: "Whether to move (cut and paste) or copy (copy and paste) the lines",
			},
			source_path: {
				type: "string",
				description: `Path to the source file (relative to ${cwd.toPosix()})`,
			},
			start_line: {
				type: "number",
				description: "First line number to extract (1-based)",
			},
			end_line: {
				type: "number",
				description: "Last line number to extract (1-based)",
			},
			target_path: {
				type: "string",
				description: `Path to the target file (relative to ${cwd.toPosix()})`,
			},
			target_line: {
				type: "number",
				description: "Line number in target file after which to insert the lines (0 for beginning)",
			},
		},
		required: ["operation", "source_path", "start_line", "end_line", "target_path", "target_line"],
	},
})
