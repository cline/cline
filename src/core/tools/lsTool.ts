import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"

export const lsToolDefinition: ToolDefinition = {
	name: "LS",
	descriptionForAgent:
		"Lists files and directories in a given path. The path parameter must be an absolute path, not a relative path. You should generally prefer the Glob and Grep tools, if you know which directories to search.",
	inputSchema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "The path of the directory to list contents for",
			},
		},
		required: ["path"],
	},
}
