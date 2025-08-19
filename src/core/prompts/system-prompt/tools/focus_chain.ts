import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "./spec"

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.TODO,
	name: "focus_chain",
	description:
		"If you were using task_progress to update the task progress, you must include the completed list in the result as well.",
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
	parameters: [
		{
			name: "task_progress",
			required: true,
			instruction:
				"A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)",
			usage: "Checklist here (optional)",
		},
	],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }
const gpt = { ...generic, variant: ModelFamily.GPT }
const gemini = { ...generic, variant: ModelFamily.GEMINI }

export const focus_chain_variants = [generic, nextGen, gpt, gemini]
