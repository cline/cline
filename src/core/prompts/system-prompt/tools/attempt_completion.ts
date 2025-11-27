import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.ATTEMPT

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "attempt_completion",
	description: `After each tool use, the user will respond with the result of that tool use, i.e. if it succeeded or failed, along with any reasons for failure. Once you've received the results of tool uses and can confirm that the task is complete, use this tool to present the result of your work to the user. Optionally you may provide a CLI command to showcase the result of your work. The user may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again.
IMPORTANT NOTE: This tool CANNOT be used until you've confirmed from the user that any previous tool uses were successful. Failure to do so will result in code corruption and system failure. Before using this tool, you must ask yourself in <thinking></thinking> tags if you've confirmed from the user that any previous tool uses were successful. If not, then DO NOT use this tool.`,
	parameters: [
		{
			name: "result",
			required: true,
			instruction: "The result of the tool use. This should be a clear, specific description of the result.",
			usage: "Your final result description here",
		},
		{
			name: "command",
			required: false,
			instruction:
				"A CLI command to execute to show a live demo of the result to the user. For example, use \`open index.html\` to display a created html website, or \`open localhost:3000\` to display a locally running development server. But DO NOT use commands like \`echo\` or \`cat\` that merely print text. This command should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions",
			usage: "Your command here (optional)",
		},
		// Different than the vanilla ASK_PROGRESS_PARAMETER
		{
			name: "task_progress",
			required: false,
			instruction:
				"A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)",
			usage: "Checklist here (required if you used task_progress in previous tool uses)",
			dependencies: [ClineDefaultTool.TODO],
			description:
				"If you were using task_progress to update the task progress, you must include the completed list in the result as well.",
		},
	],
}

const GPT_5: ClineToolSpec = {
	variant: ModelFamily.GPT_5,
	id,
	name: "attempt_completion",
	description: `After each tool use, the user will respond with the result of that tool use, i.e. if it succeeded or failed, along with any reasons for failure. Once you've received the results of tool uses and can confirm that the task is complete, use this tool to present the result of your work to the user. Optionally you may provide a CLI command to showcase the result of your work. The user may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again.
IMPORTANT NOTE: This tool CANNOT be used until you've confirmed from the user that any previous tool uses were successful and all tasks have been completed in full. Failure to do so will result in code corruption and system failure. Before using this tool, you must ask yourself in <thinking></thinking> tags if you've confirmed from the user that any previous tool uses were successful and all goals defined by the user have been completed. If not, then DO NOT use this tool.`,
	parameters: [
		{
			name: "result",
			required: true,
			instruction: "The result of the tool use. This should be a clear, specific description of the result.",
			usage: "Your final result description here",
		},
		{
			name: "command",
			required: false,
			instruction:
				"A CLI command to execute to show a live demo of the result to the user. For example, use \`open index.html\` to display a created html website, or \`open localhost:3000\` to display a locally running development server. But DO NOT use commands like \`echo\` or \`cat\` that merely print text. This command should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions",
			usage: "Your command here (optional)",
		},
		// Different than the vanilla ASK_PROGRESS_PARAMETER
		{
			name: "task_progress",
			required: false,
			instruction:
				"A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)",
			usage: "Checklist here (required if you used task_progress in previous tool uses)",
			dependencies: [ClineDefaultTool.TODO],
			description:
				"If you were using task_progress to update the task progress, you must include the completed list in the result as well.",
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "attempt_completion",
	description:
		"Once you've completed the user's task, use this tool to present the final result to the user, including a brief and very short (1-2 paragraph) summary of the task and what was done to resolve it. Provide the basics, hitting the highlights, but do delve into the specifics. You should only call this tool when you have completed all tasks in the task_progress list, and completed all changes that are necessary to satisfy the user's request. You should not provide the contents of the task_progress list in the result parameter, it must be included in the task_progress parameter.",
	parameters: [
		{
			name: "result",
			required: true,
			instruction: "A clear, brief and very short (1-2 paragraph) summary of the final result of the task.",
		},
		{
			name: "command",
			required: false,
			instruction:
				"An actionable terminal command that is non-verbose that allows user to review the result of your work. For example, use \`start localhost:3000\` to start a locally running development server. Commands like \`echo\` or \`cat\` that merely print text or open a file are not allowed. Ensure the command is properly formatted for user's OS and does not contain any harmful instructions",
		},
		{
			name: "task_progress",
			required: false,
			dependencies: [ClineDefaultTool.TODO],
			instruction:
				"A checklist showing task progress with the latest status of each subtasks included previously, if any. If you are calling attempt completion, and all items in this list have been completed, they must be marked as completed in this response.",
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const attempt_completion_variants = [generic, GPT_5, NATIVE_NEXT_GEN, NATIVE_GPT_5]
