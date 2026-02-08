import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

// HACK: Placeholder to act as tool dependency
const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.TODO,
	name: "focus_chain",
	description: "Internal tool for managing task progress and focus chain functionality.",
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
}

export const focus_chain_variants = [generic]
