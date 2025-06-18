import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"

export const askQuestionToolName = "AskQuestion"

const descriptionForAgent = `Ask the user a question to gather additional information needed to complete the task. This tool should be used when you encounter ambiguities, need clarification, or require more details to proceed effectively. It allows for interactive problem-solving by enabling direct communication with the user. Use this tool judiciously to maintain a balance between gathering necessary information and avoiding excessive back-and-forth.`

export const askQuestionToolDefinition: ToolDefinition = {
	name: askQuestionToolName,
	descriptionForAgent,
	inputSchema: {
		type: "object",
		properties: {
			question: {
				type: "string",
				description:
					"The question to ask the user. This should be a clear, specific question that addresses the information you need.",
			},
			options: {
				type: "array",
				items: {
					type: "string",
				},
				description:
					"An array of 2-5 options for the user to choose from. Each option should be a string describing a possible answer. You may not always need to provide options, but it may be helpful in many cases where it can save the user from having to type out a response manually. IMPORTANT: NEVER include an option to toggle to Act mode, as this would be something you need to direct the user to do manually themselves if needed.",
			},
		},
		required: ["question"],
	},
}
