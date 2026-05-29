import type { InstallSkillRequest } from "@shared/proto/cline/skills"
import { InstallSkillResponse, SkillSource } from "@shared/proto/cline/skills"
import axios from "axios"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { MarketplaceRecognitionService } from "@/services/recognition/MarketplaceRecognitionService"
import type { Controller } from "../index"

export async function installSkill(_controller: Controller, request: InstallSkillRequest): Promise<InstallSkillResponse> {
	const { skillId, skillUrl, name } = request
	try {
		const skillDir = path.join(os.homedir(), ".aihydro", "skills", "marketplace", skillId)
		await fs.mkdir(skillDir, { recursive: true })
		const localPath = path.join(skillDir, "SKILL.md")

		const response = await axios.get(skillUrl, { responseType: "text", timeout: 30000 })
		await fs.writeFile(localPath, response.data, "utf-8")

		await updateInstalledRegistry(skillId, name, localPath, SkillSource.MARKETPLACE)
		void MarketplaceRecognitionService.recordEvent({
			marketplace: "skills",
			itemId: skillId,
			eventType: "install",
			source: "ui",
		})

		return InstallSkillResponse.create({ skillId, localPath, success: true })
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Install failed"
		return InstallSkillResponse.create({ skillId, localPath: "", success: false, error: msg })
	}
}

export async function updateInstalledRegistry(
	skillId: string,
	name: string,
	localPath: string,
	source: SkillSource,
): Promise<void> {
	const registryPath = path.join(os.homedir(), ".aihydro", "skills", "installed.json")
	let registry: Record<string, { id: string; name: string; localPath: string; source: string; installedAt: string }> = {}
	try {
		registry = JSON.parse(await fs.readFile(registryPath, "utf-8"))
	} catch {
		// first time — start fresh
	}
	registry[skillId] = {
		id: skillId,
		name,
		localPath,
		source: SkillSource[source].toLowerCase(),
		installedAt: new Date().toISOString(),
	}
	await fs.mkdir(path.dirname(registryPath), { recursive: true })
	await fs.writeFile(registryPath, JSON.stringify(registry, null, 2))
}
