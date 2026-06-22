import { RefreshedSkills } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function refreshSkills(_controller: Controller): Promise<RefreshedSkills> {
	return RefreshedSkills.create({})
}
