import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.SEARCH_AGENT

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: id,
	description:
		"Search context using natural language input to find relevant context across different sources (codebase, files, etc.). The provided input should be a full descriptive phrase or question that'd allow the search agent to understand what you are looking for to formulate an effective search strategy that returns relevant context as results.",
	parameters: [
		{
			name: "input",
			required: true,
			instruction: `A detailed, complete natural language description or question about what you are trying to find, like 'What authentication providers are used in the codebase?' or 'The file that defined DBController symbol.' for example. IMPORTANT: Combining individual search terms or keywords like 'authentication auth providers login oauth' or 'database, config, connections' are not valid inputs and must be avoided.`,
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const search_agents_variants = [NATIVE_NEXT_GEN]
