import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { ensureRulesDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ClineRulesToggles } from "@shared/cline-rules"
import * as fs from "fs/promises"
import path from "path"
import { Controller } from "@/core/controller"
import { Logger } from "@/shared/services/Logger"
import { updateUserInstructionMarkdownDisabledState } from "./frontmatter"

/**
 * Persist a rule's UI toggle in the frontmatter consumed by the SDK rules
 * loader. The legacy rule loader reads extension state, while the SDK loader
 * reads `disabled` from the rule document itself.
 */
export async function setRuleDisabledInFrontmatter(rulePath: string, enabled: boolean): Promise<boolean> {
	if (!rulePath) {
		return false
	}
	try {
		const content = await fs.readFile(rulePath, "utf-8")
		const updated = updateUserInstructionMarkdownDisabledState(content, enabled)
		if (updated !== content) {
			await fs.writeFile(rulePath, updated)
		}
		return true
	} catch (error) {
		Logger.warn(`Failed to update rule frontmatter at ${rulePath}:`, error)
		return false
	}
}

export async function refreshClineRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: ClineRulesToggles
	localToggles: ClineRulesToggles
}> {
	// Global toggles
	const globalClineRulesToggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
	const globalClineRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalClineRulesFilePath, globalClineRulesToggles)
	controller.stateManager.setGlobalState("globalClineRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localClineRulesToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
	const localClineRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.clineRules)
	const updatedLocalToggles = await synchronizeRuleToggles(localClineRulesFilePath, localClineRulesToggles, "", [
		[".clinerules", "workflows"],
		[".clinerules", "hooks"],
		[".clinerules", "skills"],
	])
	controller.stateManager.setWorkspaceState("localClineRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
