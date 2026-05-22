import type { SaveSkillRequest } from "@shared/proto/cline/skills"
import { SaveSkillResponse, SkillSource } from "@shared/proto/cline/skills"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type { Controller } from "../index"
import { updateInstalledRegistry } from "./installSkill"

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
}

export async function saveSkill(_controller: Controller, request: SaveSkillRequest): Promise<SaveSkillResponse> {
	const { skillId: requestedId, name, description, content, domain, tags, toolsUsed, whenToUse, source } = request
	const skillId = requestedId || slugify(name)
	const sourceDir = source === SkillSource.AGENT_CREATED ? "agent-created" : "manual"

	try {
		const skillDir = path.join(os.homedir(), ".aihydro", "skills", sourceDir, skillId)
		await fs.mkdir(skillDir, { recursive: true })
		const localPath = path.join(skillDir, "SKILL.md")

		const frontmatter = [
			"---",
			`name: ${skillId}`,
			`description: ${description}`,
			`when_to_use: ${whenToUse || ""}`,
			`domain: ${domain || "general"}`,
			tags?.length ? `tags: [${tags.join(", ")}]` : "tags: []",
			toolsUsed?.length ? `tools_used: [${toolsUsed.join(", ")}]` : "tools_used: []",
			"---",
			"",
		].join("\n")

		const fullContent = content.startsWith("---") ? content : frontmatter + content
		await fs.writeFile(localPath, fullContent, "utf-8")
		await updateInstalledRegistry(skillId, name, localPath, source ?? SkillSource.MANUAL)

		return SaveSkillResponse.create({ skillId, localPath, success: true })
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Save failed"
		return SaveSkillResponse.create({ skillId, localPath: "", success: false, error: msg })
	}
}
