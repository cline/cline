import { DeleteSkillRequest, SkillsToggles } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function deleteSkillFile(_controller: Controller, _request: DeleteSkillRequest): Promise<SkillsToggles> {
	return SkillsToggles.create({})
}
