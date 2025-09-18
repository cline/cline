import { toolUseNames } from "@shared/tools"
import type { FunctionTool } from "openai/resources/responses/responses"

export function getOpenAiResponsesTools(): FunctionTool[] {
	return [
		{
			type: "function",
			name: "call_tool",
			description:
				"Execute one of Cline's built-in tools. Provide the target tool name and a JSON object of arguments that match the tool's parameters.",
			parameters: {
				type: "object",
				properties: {
					tool_name: {
						type: "string",
						enum: toolUseNames,
						description: "The identifier of the tool to invoke.",
					},
					arguments: {
						type: "object",
						description:
							"Arguments to forward to the specified tool. Each tool defines its own set of keys. Leave out keys that are not needed.",
						additionalProperties: true,
					},
				},
				required: ["tool_name", "arguments"],
				additionalProperties: false,
			},
			strict: false,
		},
	]
}
