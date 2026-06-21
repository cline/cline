import { SkillsToggles, ToggleSkillRequest } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function toggleSkill(_controller: Controller, _request: ToggleSkillRequest): Promise<SkillsToggles> {
	return SkillsToggles.create({})
}
