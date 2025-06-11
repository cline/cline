import { moveLinesToolDefinition } from "./moveLinesTools"
import { moveLines } from "./moveLines"
import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"

export const moveLinesTool = (
	cwd: string,
): ToolDefinition & {
	handler: (tool: { params: Record<string, string> }) => Promise<string>
} => ({
	...moveLinesToolDefinition(cwd),
	handler: async (tool) => {
		const { operation, source_path, start_line, end_line, target_path, target_line } = tool.params

		if (!operation || !source_path || !start_line || !end_line || !target_path || !target_line) {
			throw new Error("Missing required parameters")
		}

		if (operation !== "move" && operation !== "copy") {
			throw new Error('Operation must be either "move" or "copy"')
		}

		await moveLines(operation, source_path, parseInt(start_line), parseInt(end_line), target_path, parseInt(target_line), cwd)

		return `Successfully ${operation}d lines ${start_line}-${end_line} from ${source_path} to line ${target_line} in ${target_path}`
	},
})
