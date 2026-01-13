import type { ToolUse } from "@core/assistant-message"
import { discoverSkills, getAvailableSkills, getSkillContent } from "@core/context/instructions/user-instructions/skills"
import type { SkillMetadata } from "@shared/skills"
import { telemetryService } from "@/services/telemetry"
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

		// Discover skills on-demand (lazy loading)
		const allSkills = await discoverSkills(config.cwd)
		const resolvedSkills = getAvailableSkills(allSkills)

		// Filter by toggle state
		const stateManager = config.services.stateManager
		const globalSkillsToggles = stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {}
		const localSkillsToggles = stateManager.getWorkspaceStateKey("localSkillsToggles") ?? {}
		const availableSkills = resolvedSkills.filter((skill) => {
			const toggles = skill.source === "global" ? globalSkillsToggles : localSkillsToggles
			return toggles[skill.path] !== false
		})

		if (availableSkills.length === 0) {
			return `Error: No skills are available. Skills may be disabled or not configured.`
		}

		const globalCount = availableSkills.filter((skill) => skill.source === "global").length
		const projectCount = availableSkills.filter((skill) => skill.source === "project").length

		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider

		// Show tool message
		const message = JSON.stringify({ tool: "useSkill", path: skillName })
		await config.callbacks.say("tool", message, undefined, undefined, false)

		config.taskState.consecutiveMistakeCount = 0

		try {
			const skillContent = await getSkillContent(skillName, availableSkills)

			if (!skillContent) {
				const availableNames = availableSkills.map((s: SkillMetadata) => s.name).join(", ")
				return `Error: Skill "${skillName}" not found. Available skills: ${availableNames || "none"}`
			}

			telemetryService.safeCapture(
				() =>
					telemetryService.captureSkillUsed({
						ulid: config.ulid,
						skillName,
						skillSource: skillContent.source === "global" ? "global" : "project",
						skillsAvailableGlobal: globalCount,
						skillsAvailableProject: projectCount,
						provider,
						modelId: config.api.getModel().id,
					}),
				"UseSkillToolHandler.execute",
			)

			return `# Skill "${skillContent.name}" is now active

${skillContent.instructions}

---
IMPORTANT: The skill is now loaded. Do NOT call use_skill again for this task. Simply follow the instructions above to complete the user's request. You may access other files in the skill directory at: ${skillContent.path.replace(/SKILL\.md$/, "")}`
		} catch (error) {
			return `Error loading skill "${skillName}": ${(error as Error)?.message}`
		}
	}
}
