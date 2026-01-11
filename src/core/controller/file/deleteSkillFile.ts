import { DeleteSkillRequest, SkillsToggles } from "@shared/proto/cline/file"
import fs from "fs/promises"
import path from "path"
import { fileExistsAtPath } from "@/utils/fs"
import { Controller } from ".."

/**
 * Deletes an existing skill directory
 * @param controller The controller instance
 * @param request The request containing skill path and isGlobal flag
 * @returns The updated skills toggles
 */
export async function deleteSkillFile(controller: Controller, request: DeleteSkillRequest): Promise<SkillsToggles> {
	const { skillPath, isGlobal } = request

	if (!skillPath || typeof skillPath !== "string" || typeof isGlobal !== "boolean") {
		console.error("deleteSkillFile: Missing or invalid parameters", {
			skillPath: typeof skillPath === "string" ? skillPath : `Invalid: ${typeof skillPath}`,
			isGlobal: typeof isGlobal === "boolean" ? isGlobal : `Invalid: ${typeof isGlobal}`,
		})
		throw new Error("Missing or invalid parameters for deleteSkillFile")
	}

	// Get the skill directory (skillPath points to SKILL.md, so get parent)
	const skillDir = path.dirname(skillPath)

	// Verify the path exists
	if (!(await fileExistsAtPath(skillDir))) {
		console.warn(`deleteSkillFile: Skill directory not found: ${skillDir}`)
		// Return current toggles anyway
		const globalToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {}
		const localToggles = controller.stateManager.getWorkspaceStateKey("localSkillsToggles") || {}
		return SkillsToggles.create({
			globalSkillsToggles: globalToggles,
			localSkillsToggles: localToggles,
		})
	}

	// Delete the skill directory
	await fs.rm(skillDir, { recursive: true, force: true })

	// Remove from toggles
	let globalToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {}
	let localToggles = controller.stateManager.getWorkspaceStateKey("localSkillsToggles") || {}

	if (isGlobal) {
		const { [skillPath]: _, ...remaining } = globalToggles
		globalToggles = remaining
		controller.stateManager.setGlobalState("globalSkillsToggles", globalToggles)
	} else {
		const { [skillPath]: _, ...remaining } = localToggles
		localToggles = remaining
		controller.stateManager.setWorkspaceState("localSkillsToggles", localToggles)
	}

	await controller.postStateToWebview()

	return SkillsToggles.create({
		globalSkillsToggles: globalToggles,
		localSkillsToggles: localToggles,
	})
}
