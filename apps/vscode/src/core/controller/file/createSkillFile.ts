import { CreateSkillRequest, SkillsToggles } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function createSkillFile(_controller: Controller, _request: CreateSkillRequest): Promise<SkillsToggles> {
	return SkillsToggles.create({})
}
