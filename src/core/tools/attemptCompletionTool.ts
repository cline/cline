import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"

export const attemptCompletionToolName = "AttemptCompletion"

const descriptionForAgent = `After each tool use, the user will respond with the result of that tool use, i.e. if it succeeded or failed, along with any reasons for failure. Once you've received the results of tool uses and can confirm that the task is complete, use this tool to present the result of your work to the user. Optionally you may provide a CLI command to showcase the result of your work. The user may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again.
IMPORTANT NOTE: This tool CANNOT be used until you've confirmed from the user that any previous tool uses were successful. Failure to do so will result in code corruption and system failure. Before using this tool, you must ask yourself in <thinking></thinking> tags if you've confirmed from the user that any previous tool uses were successful. If not, then DO NOT use this tool.`

export const attemptCompletionToolDefinition: ToolDefinition = {
	name: attemptCompletionToolName,
	descriptionForAgent,
	inputSchema: {
		type: "object",
		properties: {
			result: {
				type: "string",
				description:
					"The result of the task. Formulate this result in a way that is final and does not require further input from the user. Don't end your result with questions or offers for further assistance.",
			},
			command: {
				type: "string",
				description:
					"A CLI command to execute to show a live demo of the result to the user. For example, use `open index.html` to display a created html website, or `open localhost:3000` to display a locally running development server. But DO NOT use commands like `echo` or `cat` that merely print text. This command should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.",
			},
		},
		required: ["result"],
	},
}
