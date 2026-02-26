import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.USE_SUBAGENTS

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "use_subagents",
	description:
		"Run up to five focused in-process subagents in parallel. Each subagent gets its own prompt and returns a comprehensive research result with tool and token stats. Use this for broad exploration when reading many files would consume the main agent's context window. You do not need to launch multiple subagents every time; using one subagent is valid when it avoids unnecessary context usage for light discovery work.",
	contextRequirements: (context) => context.subagentsEnabled === true && !context.isSubagentRun,
	parameters: [
		{
			name: "prompt_1",
			required: true,
			instruction: "First subagent prompt.",
		},
		{
			name: "prompt_2",
			required: false,
			instruction: "Optional second subagent prompt.",
		},
		{
			name: "prompt_3",
			required: false,
			instruction: "Optional third subagent prompt.",
		},
		{
			name: "prompt_4",
			required: false,
			instruction: "Optional fourth subagent prompt.",
		},
		{
			name: "prompt_5",
			required: false,
			instruction: "Optional fifth subagent prompt.",
		},
	],
}

export const subagent_variants = [generic]
