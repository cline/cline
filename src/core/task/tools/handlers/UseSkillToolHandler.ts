import type { ToolUse } from "@core/assistant-message"
import { getSkillContent } from "@core/context/instructions/user-instructions/skills"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class UseSkillToolHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.USE_SKILL

	constructor() {}

	getDescription(block: ToolUse): string {
		const skillName = block.params.skill_name
		return skillName ? `[${block.name} for "${skillName}"]` : `[${block.name}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const skillName = block.params.skill_name
		const message = JSON.stringify({ tool: "useSkill", path: skillName || "" })
		await uiHelpers.say("tool", message, undefined, undefined, true)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const skillName: string | undefined = block.params.skill_name

		if (!skillName) {
			config.taskState.consecutiveMistakeCount++
			return `Error: Missing required parameter 'skill_name'. Please provide the name of the skill to activate.`
		}

		const availableSkills = config.skills
		if (!availableSkills || availableSkills.length === 0) {
			return `Error: Skills are not available in this context.`
		}

		// Show tool message
		const message = JSON.stringify({ tool: "useSkill", path: skillName })
		await config.callbacks.say("tool", message, undefined, undefined, false)

		config.taskState.consecutiveMistakeCount = 0

		try {
			const skillContent = await getSkillContent(skillName, availableSkills)

			if (!skillContent) {
				const availableNames = availableSkills.map((s) => s.name).join(", ")
				return `Error: Skill "${skillName}" not found. Available skills: ${availableNames || "none"}`
			}

			return `# Skill "${skillContent.name}" is now active

${skillContent.instructions}

---
IMPORTANT: The skill is now loaded. Do NOT call use_skill again for this task. Simply follow the instructions above to complete the user's request. You may access other files in the skill directory at: ${skillContent.path.replace(/SKILL\.md$/, "")}`
		} catch (error) {
			return `Error loading skill "${skillName}": ${(error as Error)?.message}`
		}
	}
}
