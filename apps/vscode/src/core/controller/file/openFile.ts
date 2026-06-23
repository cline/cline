import { parseYamlFrontmatter } from "@core/context/instructions/user-instructions/frontmatter"
import { StateManager } from "@core/storage/StateManager"
import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { Empty, StringRequest } from "@shared/proto/cline/common"
import { REMOTE_URI_SCHEME } from "@shared/remote-config/constants"
import type { GlobalInstructionsFile } from "@shared/remote-config/schema"
import { writeFile } from "@utils/fs"
import * as os from "os"
import * as path from "path"
import { Controller } from ".."

/**
 * Opens a file in the editor
 * @param controller The controller instance
 * @param request The request message containing the file path in the 'value' field.
 *                Supports special URI format for remote rules/workflows/skills:
 *                - remote://rule/{ruleName}
 *                - remote://workflow/{workflowName}
 *                - remote://skill/{skillName}
 * @returns Empty response
 */
export async function openFile(_controller: Controller, request: StringRequest): Promise<Empty> {
	if (request.value) {
		// Check for remote:// prefix for remote rules/workflows
		if (request.value.startsWith(REMOTE_URI_SCHEME)) {
			await openRemoteFile(request.value)
		} else {
			await openFileIntegration(request.value)
		}
	}
	return Empty.create()
}

/**
 * Opens a remote rule, workflow, or skill file by creating a temp file with its contents
 * @param uri The remote URI in format: remote://rule/{name}, remote://workflow/{name}, or remote://skill/{name}
 */
async function openRemoteFile(uri: string): Promise<void> {
	// Parse: remote://rule/{name}, remote://workflow/{name}, or remote://skill/{name}
	const match = uri.match(/^remote:\/\/(rule|workflow|skill)\/(.+)$/)
	if (!match) {
		throw new Error(`Invalid remote file URI: ${uri}`)
	}

	const [, type, name] = match
	const remoteConfig = StateManager.get().getRemoteConfigSettings()

	// Look up content based on type
	let items: GlobalInstructionsFile[] | undefined
	if (type === "rule") {
		items = remoteConfig.remoteGlobalRules
	} else if (type === "workflow") {
		items = remoteConfig.remoteGlobalWorkflows
	} else {
		items = remoteConfig.remoteGlobalSkills
	}
	// Try entry.name first (fast path), fall back to frontmatter.name for skills
	// in case entry.name drifts from the frontmatter
	let item = items?.find((r) => r.name === name)
	if (!item && type === "skill") {
		item = items?.find((r) => {
			const { data } = parseYamlFrontmatter(r.contents)
			return typeof data.name === "string" && data.name === name
		})
	}

	if (!item?.contents) {
		throw new Error(`Remote ${type} not found: ${name}`)
	}

	// Create temp file with read-only header comment
	const header = `# ⚠️ READ-ONLY: This ${type} is managed by your organization.\n# Changes made here will not be saved.\n\n`
	const content = header + item.contents

	// Sanitize the name for use in filename (replace invalid characters)
	const sanitizedName = name.replace(/[<>:"/\\|?*]/g, "_")
	const tempPath = path.join(os.tmpdir(), `cline-remote-${type}-${sanitizedName}.md`)

	await writeFile(tempPath, content)
	await openFileIntegration(tempPath)
}
