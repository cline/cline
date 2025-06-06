import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"

export const editToolDefinition: ToolDefinition = {
	name: "MultiEdit",
	descriptionForAgent:
		"Makes multiple changes to a single file in one operation. Use this tool to edit files by providing the exact text to replace and the new text.",
	inputSchema: {
		type: "object",
		properties: {
			file_path: {
				type: "string",
				description: "Absolute path to the file to modify",
			},
			edits: {
				type: "array",
				description: "Array of edit operations, each containing old_string and new_string",
				items: {
					type: "object",
					properties: {
						old_string: {
							type: "string",
							description: "Exact text to replace",
						},
						new_string: {
							type: "string",
							description: "The replacement text",
						},
					},
					required: ["old_string", "new_string"],
				},
			},
		},
		required: ["file_path", "edits"],
	},
}
