import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.USE_SKILL

const generic: ClineToolSpec = {
	id,
	variant: ModelFamily.GENERIC,
	name: "use_skill",
	description:
		"Load and activate a skill by name. Skills provide specialized instructions for specific tasks. Use this tool ONCE when a user's request matches one of the available skill descriptions shown in the SKILLS section of your system prompt. After activation, follow the skill's instructions directly - do not call use_skill again.",
	contextRequirements: (context) => context.skills !== undefined && context.skills.length > 0,
	parameters: [
		{
			name: "skill_name",
			required: true,
			instruction: "The name of the skill to activate (must match exactly one of the available skill names)",
		},
	],
}

export const use_skill_variants = [generic]
