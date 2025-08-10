import * as path from "path"
import { Controller } from ".."
import { Empty, StringRequest } from "@shared/proto/cline/common"
import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { getWorkspacePath } from "@utils/path"

/**
 * Opens a file in the editor by a relative path
 * @param controller The controller instance
 * @param request The request message containing the relative file path in the 'value' field
 * @returns Empty response
 */
export async function openFileRelativePath(_controller: Controller, request: StringRequest): Promise<Empty> {
	const workspacePath = await getWorkspacePath()

	if (!workspacePath) {
		console.error("Error in openFileRelativePath: No workspace path available")
		return Empty.create()
	}

	if (request.value) {
		// Resolve the relative path to absolute path
		const absolutePath = path.resolve(workspacePath, request.value)

		// Open the file using the existing integration
		openFileIntegration(absolutePath)
	}

	return Empty.create()
}
