import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { ensureRulesDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { BedrockCoderRulesToggles } from "@shared/bedrock-coder-rules"
import path from "path"
import { Controller } from "@/core/controller"

export async function refreshBedrockCoderRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: BedrockCoderRulesToggles
	localToggles: BedrockCoderRulesToggles
}> {
	// Global toggles
	const globalBedrockCoderRulesToggles = controller.stateManager.getGlobalSettingsKey("globalBedrockCoderRulesToggles")
	const globalBedrockCoderRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalBedrockCoderRulesFilePath, globalBedrockCoderRulesToggles)
	controller.stateManager.setGlobalState("globalBedrockCoderRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localBedrockCoderRulesToggles = controller.stateManager.getWorkspaceStateKey("localBedrockCoderRulesToggles")
	const localBedrockCoderRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.bedrockCoderRules)
	const updatedLocalToggles = await synchronizeRuleToggles(localBedrockCoderRulesFilePath, localBedrockCoderRulesToggles, "", [
		[".bedrock-coder", "workflows"],
		[".bedrock-coder", "hooks"],
		[".bedrock-coder", "skills"],
	])
	controller.stateManager.setWorkspaceState("localBedrockCoderRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
