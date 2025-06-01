import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"

export const planModeRespondToolName = "PlanModeRespond"

const descriptionForAgent = `Respond to the user's inquiry in an effort to plan a solution to the user's task. This tool should be used when you need to provide a response to a question or statement from the user about how you plan to accomplish the task. This tool is only available in PLAN MODE. The environment_details will specify the current mode, if it is not PLAN MODE then you should not use this tool. Depending on the user's message, you may ask questions to get clarification about the user's request, architect a solution to the task, and to brainstorm ideas with the user. For example, if the user's task is to create a website, you may start by asking some clarifying questions, then present a detailed plan for how you will accomplish the task given the context, and perhaps engage in a back and forth to finalize the details before the user switches you to ACT MODE to implement the solution.`

export const planModeRespondToolDefinition: ToolDefinition = {
	name: planModeRespondToolName,
	descriptionForAgent,
	inputSchema: {
		type: "object",
		properties: {
			response: {
				type: "string",
				description:
					"The response to provide to the user. Do not try to use tools in this parameter, this is simply a chat response. (You MUST use the response parameter)",
			},
		},
		required: ["response"],
	},
}
