import { Empty } from "@shared/proto/cline/common"
import type { DeleteSkillRequest } from "@shared/proto/cline/skills"
import { SkillSource } from "@shared/proto/cline/skills"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type { Controller } from "../index"

export async function deleteSkill(_controller: Controller, request: DeleteSkillRequest): Promise<Empty> {
	const { skillId, source } = request
	const sourceDir =
		source === SkillSource.AGENT_CREATED ? "agent-created" : source === SkillSource.MARKETPLACE ? "marketplace" : "manual"

	try {
		const skillDir = path.join(os.homedir(), ".aihydro", "skills", sourceDir, skillId)
		await fs.rm(skillDir, { recursive: true, force: true })

		// Remove from installed.json
		const registryPath = path.join(os.homedir(), ".aihydro", "skills", "installed.json")
		try {
			const registry = JSON.parse(await fs.readFile(registryPath, "utf-8"))
			delete registry[skillId]
			await fs.writeFile(registryPath, JSON.stringify(registry, null, 2))
		} catch {
			// registry missing — nothing to remove
		}
	} catch (error) {
		console.error("Failed to delete skill:", skillId, error)
	}

	return Empty.create({})
}
