import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * ## plan_mode_respond
Description: Respond to the user's inquiry in an effort to plan a solution to the user's task. This tool should ONLY be used when you have already explored the relevant files and are ready to present a concrete plan. DO NOT use this tool to announce what files you're going to read - just read them first. This tool is only available in PLAN MODE. The environment_details will specify the current mode; if it is not PLAN_MODE then you should not use this tool.
However, if while writing your response you realize you actually need to do more exploration before providing a complete plan, you can add the optional needs_more_exploration parameter to indicate this. This allows you to acknowledge that you should have done more exploration first, and signals that your next message will use exploration tools instead.
Parameters:
- response: (required) The response to provide to the user. Do not try to use tools in this parameter, this is simply a chat response. (You MUST use the response parameter, do not simply place the response text directly within <plan_mode_respond> tags.)
- needs_more_exploration: (optional) Set to true if while formulating your response that you found you need to do more exploration with tools, for example reading files. (Remember, you can explore the project with tools like read_file in PLAN MODE without the user having to toggle to ACT MODE.) Defaults to false if not specified.
${focusChainSettings.enabled ? `- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)` : "" }
Usage:
<plan_mode_respond>
<response>Your response here</response>
<needs_more_exploration>true or false (optional, but you MUST set to true if in <response> you need to read files or use other exploration tools)</needs_more_exploration>
${focusChainSettings.enabled ? `<task_progress>
Checklist here (If you have presented the user with concrete steps or requirements, you can optionally include a todo list outlining these steps.)
</task_progress>` : "" }
</plan_mode_respond>
 */

const id = ClineDefaultTool.PLAN_MODE

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "plan_mode_respond",
	description: `Respond to the user's inquiry in an effort to plan a solution to the user's task. This tool should ONLY be used when you have already explored the relevant files and are ready to present a concrete plan. DO NOT use this tool to announce what files you're going to read - just read them first. This tool is only available in PLAN MODE. The environment_details will specify the current mode; if it is not PLAN_MODE then you should not use this tool.
However, if while writing your response you realize you actually need to do more exploration before providing a complete plan, you can add the optional needs_more_exploration parameter to indicate this. This allows you to acknowledge that you should have done more exploration first, and signals that your next message will use exploration tools instead.`,
	parameters: [
		{
			name: "response",
			required: true,
			instruction: `The response to provide to the user. Do not try to use tools in this parameter, this is simply a chat response. (You MUST use the response parameter, do not simply place the response text directly within <plan_mode_respond> tags.)`,
			usage: "Your response here",
		},
		{
			name: "needs_more_exploration",
			required: false,
			instruction:
				"Set to true if while formulating your response that you found you need to do more exploration with tools, for example reading files. (Remember, you can explore the project with tools like read_file in PLAN MODE without the user having to toggle to ACT MODE.) Defaults to false if not specified.",
			usage: "true or false (optional, but you MUST set to true if in <response> you need to read files or use other exploration tools)",
			type: "boolean",
		},
		// Different than the vanilla TASK_PROGRESS_PARAMETER
		{
			name: "task_progress",
			required: false,
			instruction:
				" A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)",
			usage: "Checklist here (If you have presented the user with concrete steps or requirements, you can optionally include a todo list outlining these steps.)",
			dependencies: [ClineDefaultTool.TODO],
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "plan_mode_respond",
	description: `Respond to the user's inquiry in an effort to plan a solution to the user's task. This tool should ONLY be used when you have already explored the relevant files and are ready to present a concrete plan. DO NOT use this tool to announce what files you're going to read - just read them first. This tool is only available in PLAN MODE. The environment_details will specify the current mode; if it is not PLAN_MODE then you should not use this tool.
However, if while writing your response you realize you actually need to do more exploration before providing a complete plan, you can add the optional needs_more_exploration parameter to indicate this. This allows you to acknowledge that you should have done more exploration first, and signals that your next message will use exploration tools instead.`,
	parameters: [
		{
			name: "response",
			required: true,
			instruction: `The response to provide to the user. Do not try to use tools in this parameter, this is simply a chat response. (You MUST use the response parameter, do not simply place the response text directly within <plan_mode_respond> tags.)`,
			usage: "Your response here",
		},
		{
			name: "task_progress",
			required: false,
			instruction: "A checklist showing task progress with the latest status of each subtasks included previously if any.",
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const plan_mode_respond_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
