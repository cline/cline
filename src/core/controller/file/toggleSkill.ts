import { SkillsToggles, ToggleSkillRequest } from "@shared/proto/cline/file"
import { Controller } from ".."

/**
 * Toggles a skill on or off
 * @param controller The controller instance
 * @param request The request containing the skill path and enabled state
 * @returns The updated skills toggles
 */
export async function toggleSkill(controller: Controller, request: ToggleSkillRequest): Promise<SkillsToggles> {
	const { skillPath, isGlobal, enabled } = request

	if (!skillPath || typeof enabled !== "boolean" || typeof isGlobal !== "boolean") {
		console.error("toggleSkill: Missing or invalid parameters", {
			skillPath,
			isGlobal,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleSkill")
	}

	let globalToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {}
	let localToggles = controller.stateManager.getWorkspaceStateKey("localSkillsToggles") || {}

	if (isGlobal) {
		globalToggles = { ...globalToggles, [skillPath]: enabled }
		controller.stateManager.setGlobalState("globalSkillsToggles", globalToggles)
	} else {
		localToggles = { ...localToggles, [skillPath]: enabled }
		controller.stateManager.setWorkspaceState("localSkillsToggles", localToggles)
	}

	await controller.postStateToWebview()

	return SkillsToggles.create({
		globalSkillsToggles: globalToggles,
		localSkillsToggles: localToggles,
	})
}
