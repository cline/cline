import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * ## act_mode_respond
Description: Provide a progress update or preamble to the user during ACT MODE execution. This tool allows you to communicate your thought process and what you're about to do, without interrupting the execution flow. After displaying your message, execution will automatically continue, allowing you to proceed with subsequent tool calls. This tool is only available in ACT MODE for OpenAI native models. The environment_details will specify the current mode; if it is not ACT_MODE then you should not use this tool.
Use this tool when you want to:
- Explain what you're about to do before executing tools
- Provide progress updates during long-running tasks
- Clarify your approach or reasoning
- Keep the user informed of your progress
Parameters:
- response: (required) The message to provide to the user. This should explain what you're about to do, your current progress, or your reasoning. (You MUST use the response parameter, do not simply place the response text directly within <act_mode_respond> tags.)
- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)
Usage:
<act_mode_respond>
<response>Your message here</response>
<task_progress>Checklist here (optional)</task_progress>
</act_mode_respond>
 */

const id = ClineDefaultTool.ACT_MODE

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "act_mode_respond",
	description: `Provide a progress update or preamble to the user during ACT MODE execution. This tool allows you to communicate your thought process and planned actions without interrupting the execution flow. After displaying your message, execution automatically continues, allowing you to proceed with subsequent tool calls immediately. This tool is only available in ACT MODE. This tool may not be called immediately after a previous act_mode_respond call.

IMPORTANT: Use this tool frequently to create a better user experience. Since it's non-blocking, there's no performance penalty for frequent use.

Use this tool when:
- After reading files and before making any edits - explain your analysis and what changes you plan to make
- When starting a new phase of work (e.g., transitioning from backend to frontend, or from one feature to another)
- During long sequences of operations to provide progress updates
- When your approach or strategy changes mid-task
- Before executing complex or potentially risky operations
- To explain why you're choosing one approach over another

Do NOT use this tool when you have completed all required actions and are ready to present the final output; in that case, use the attempt_completion tool instead.

CRITICAL CONSTRAINT: You MUST NOT call this tool more than once in a row. After using act_mode_respond, your next assistant message MUST either call a different tool or perform additional work without using act_mode_respond again. If you attempt to call act_mode_respond consecutively, the tool call will fail with an explicit error.`,
	parameters: [
		{
			name: "response",
			required: true,
			instruction: `The message to provide to the user. This should explain what you're about to do, your current progress, or your reasoning. The response should be brief and conversational in tone, aiming to keep the user informed without overwhelming them with details.`,
			usage: "Your message here",
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

const GEMINI_3: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.GEMINI_3,
}

export const act_mode_respond_variants = [NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
