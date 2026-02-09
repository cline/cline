import { ModelFamily } from "@/shared/prompts"
import { BeadsmithDefaultTool } from "@/shared/tools"
import type { BeadsmithToolSpec } from "../spec"

// HACK: Placeholder to act as tool dependency
const generic: BeadsmithToolSpec = {
	variant: ModelFamily.GENERIC,
	id: BeadsmithDefaultTool.TODO,
	name: "focus_chain",
	description: "",
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
}

export const focus_chain_variants = [generic]
