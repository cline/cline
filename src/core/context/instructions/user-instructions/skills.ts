import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

export type SkillToggles = Record<string, boolean> // skillId → enabled (default true)

/**
 * Reads all installed + enabled skills and returns their combined content
 * for injection into the system prompt.
 */
export async function getInstalledSkillsInstructions(toggles: SkillToggles): Promise<string | undefined> {
	const registryPath = path.join(os.homedir(), ".aihydro", "skills", "installed.json")
	let registry: Record<string, { id: string; name: string; localPath: string }> = {}
	try {
		registry = JSON.parse(await fs.readFile(registryPath, "utf-8"))
	} catch {
		return undefined
	}

	const parts: string[] = []
	for (const entry of Object.values(registry)) {
		// A skill is enabled unless explicitly set to false
		if (toggles[entry.id] === false) continue
		try {
			const content = (await fs.readFile(entry.localPath, "utf-8")).trim()
			if (content) {
				parts.push(`## Skill: ${entry.name}\n\n${content}`)
			}
		} catch {
			// file removed since install — skip silently
		}
	}

	if (parts.length === 0) return undefined
	return `# AI-Hydro Workflow Skills\n\nThe following workflow playbooks are active. Follow them when the relevant task arises.\n\n${parts.join("\n\n---\n\n")}`
}
