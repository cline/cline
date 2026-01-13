import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

// HACK: Placeholder to act as tool dependency
// Fixes #7696: AWS Bedrock requires non-empty tool descriptions (min length: 1)
const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.TODO,
	name: "focus_chain",
	description: "Manage focus chain for task context tracking",
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
}

export const focus_chain_variants = [generic]
