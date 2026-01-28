import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.SUBAGENT

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: id,
	description:
		"Launch a new agent to handle complex, multi-step tasks autonomously. The agent has access to search and bash tools to gather information from inside and outside the codebase. Use this for tasks that require multiple steps of exploration or research before reaching a conclusion.",
	parameters: [
		{
			name: "prompt",
			required: true,
			instruction: `A highly detailed task description for the agent to perform autonomously. The prompt should include:
1. What the agent needs to accomplish
2. Whether the agent should write code or just do research (search, file reads, etc.)
3. Exactly what information should be returned in the agent's final response

IMPORTANT: Each agent invocation is stateless - you cannot send follow-up messages. Make your prompt comprehensive and self-contained.`,
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const subagent_variants = [NATIVE_NEXT_GEN]
