import type { EmptyRequest } from "@shared/proto/cline/common"
import { SkillCatalog, SkillItem, SkillSource } from "@shared/proto/cline/skills"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type { Controller } from "../index"

function sourceFromString(s: string): SkillSource {
	if (s === "agent_created") return SkillSource.AGENT_CREATED
	if (s === "manual") return SkillSource.MANUAL
	return SkillSource.MARKETPLACE
}

function parseFrontmatter(raw: string): Record<string, string | string[]> {
	const result: Record<string, string | string[]> = {}
	const match = raw.match(/^---\n([\s\S]*?)\n---/)
	if (!match) return result
	for (const line of match[1].split("\n")) {
		const colonIdx = line.indexOf(":")
		if (colonIdx === -1) continue
		const key = line.slice(0, colonIdx).trim()
		const val = line.slice(colonIdx + 1).trim()
		if (val.startsWith("[") && val.endsWith("]")) {
			result[key] = val
				.slice(1, -1)
				.split(",")
				.map((v) => v.trim())
				.filter(Boolean)
		} else {
			result[key] = val
		}
	}
	return result
}

export async function listInstalledSkills(_controller: Controller, _request: EmptyRequest): Promise<SkillCatalog> {
	const skillsBase = path.join(os.homedir(), ".aihydro", "skills")
	const items: SkillItem[] = []

	// Load installed registry
	let registry: Record<string, { id: string; name: string; localPath: string; source: string; installedAt: string }> = {}
	try {
		registry = JSON.parse(await fs.readFile(path.join(skillsBase, "installed.json"), "utf-8"))
	} catch {
		return SkillCatalog.create({ items: [] })
	}

	for (const entry of Object.values(registry)) {
		try {
			const raw = await fs.readFile(entry.localPath, "utf-8")
			const fm = parseFrontmatter(raw)
			items.push(
				SkillItem.create({
					skillId: entry.id,
					name: entry.name,
					description: (fm.description as string) || "",
					domain: (fm.domain as string) || "general",
					tags: (fm.tags as string[]) || [],
					toolsUsed: (fm.tools_used as string[]) || [],
					whenToUse: (fm.when_to_use as string) || "",
					isInstalled: true,
					source: sourceFromString(entry.source),
					createdAt: entry.installedAt,
					updatedAt: entry.installedAt,
					content: raw,
					codiconIcon: "book",
				}),
			)
		} catch {
			// file disappeared — skip
		}
	}

	return SkillCatalog.create({ items })
}
