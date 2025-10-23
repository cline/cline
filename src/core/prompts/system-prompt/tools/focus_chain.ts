import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

// HACK: Placeholder to act as tool dependency
const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.TODO,
	name: "focus_chain",
	description: "",
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
}

// const GPT_5: ClineToolSpec = {
// 	variant: ModelFamily.GPT_5,
// 	id: ClineDefaultTool.TODO,
// 	name: "task_progress",
// 	description:
// 		"Create a checklist detailing the progress of the task. Use this to keep track of completed and pending subtasks.",
// 	contextRequirements: (context) => context.providerInfo.model.id.includes("gpt-5"),
// 	parameters: [
// 		{
// 			name: "task_progress",
// 			required: false,
// 			instruction: "A checklist showing task progress with the latest status of each subtasks included previously if any.",
// 		},
// 	],
// }

export const focus_chain_variants = [generic]
