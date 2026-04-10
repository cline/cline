import { StateManager } from "@core/storage/StateManager"
import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { Empty, StringRequest } from "@shared/proto/cline/common"
import { REMOTE_URI_SCHEME } from "@shared/remote-config/constants"
import { writeFile } from "@utils/fs"
import * as os from "os"
import * as path from "path"
import { Controller } from ".."

/**
 * Opens a file in the editor
 * @param controller The controller instance
 * @param request The request message containing the file path in the 'value' field.
 *                Supports special URI format for remote rules:
 *                - remote://rule/{ruleName}
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
 * Opens a remote rule file by creating a temp file with its contents
 * @param uri The remote URI in format: remote://rule/{name}
 */
async function openRemoteFile(uri: string): Promise<void> {
	const match = uri.match(/^remote:\/\/rule\/(.+)$/)
	if (!match) {
		throw new Error(`Invalid remote file URI: ${uri}`)
	}

	const [, name] = match
	const remoteConfig = StateManager.get().getRemoteConfigSettings()
	const item = remoteConfig.remoteGlobalRules?.find((r) => r.name === name)

	if (!item?.contents) {
		throw new Error(`Remote rule not found: ${name}`)
	}

	// Create temp file with read-only header comment
	const header = "# ⚠️ READ-ONLY: This rule is managed by your organization.\n# Changes made here will not be saved.\n\n"
	const content = header + item.contents

	// Sanitize the name for use in filename (replace invalid characters)
	const sanitizedName = name.replace(/[<>:"/\\|?*]/g, "_")
	const tempPath = path.join(os.tmpdir(), `cline-remote-rule-${sanitizedName}.md`)

	await writeFile(tempPath, content)
	await openFileIntegration(tempPath)
}
