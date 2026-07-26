import { setSkillDisabledInFrontmatter } from "@core/context/instructions/user-instructions/skills"
import { SkillsToggles, ToggleSkillRequest } from "@shared/proto/bedrock_coder/file"
import { Logger } from "@/shared/services/Logger"
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
		Logger.error("toggleSkill: Missing or invalid parameters", {
			skillPath,
			isGlobal,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleSkill")
	}

	let globalToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {}
	let localToggles = controller.stateManager.getWorkspaceStateKey("localSkillsToggles") || {}

	if (skillPath.startsWith("remote:")) {
		throw new Error("Remote skills are not supported")
	}
	if (isGlobal) {
		globalToggles = { ...globalToggles, [skillPath]: enabled }
		controller.stateManager.setGlobalState("globalSkillsToggles", globalToggles)
	} else {
		localToggles = { ...localToggles, [skillPath]: enabled }
		controller.stateManager.setWorkspaceState("localSkillsToggles", localToggles)
	}

	// Persist the enabled state to the SKILL.md frontmatter as well. The SDK
	// builds the model's skill list / `skills` tool from the frontmatter
	// `disabled` flag, not from the extension's UI toggle state, so without this
	// write a skill toggled off in the sidebar would still be offered to the
	// model (ENG-1995). The helper is a no-op for remote skills (no backing file).
	await setSkillDisabledInFrontmatter(skillPath, enabled)

	await controller.postStateToWebview()

	return SkillsToggles.create({
		globalSkillsToggles: globalToggles,
		localSkillsToggles: localToggles,
	})
}
