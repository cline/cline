import { BooleanResponse, StringRequest } from "@shared/proto/cline/common"
import { getWorkspacePath } from "@utils/path"
import * as fs from "fs"
import * as path from "path"
import { Controller } from ".."

/**
 * Check if a file exists in the project using a relative path
 * @param controller The controller instance
 * @param request The request containing the relative file path to check
 * @returns BooleanResponse indicating whether the file exists
 */
export async function ifFileExistsRelativePath(_controller: Controller, request: StringRequest): Promise<BooleanResponse> {
	const workspacePath = await getWorkspacePath()

	if (!workspacePath) {
		// If no workspace is open, return false
		console.error("Error in ifFileExistsRelativePath: No workspace path available") // TODO
		return BooleanResponse.create({ value: false })
	}

	if (!request.value) {
		// If no path provided, return false
		return BooleanResponse.create({ value: false })
	}

	// Resolve the relative path to absolute path
	const absolutePath = path.resolve(workspacePath, request.value)
	// Check if the file exists
	try {
		return BooleanResponse.create({ value: fs.statSync(absolutePath).isFile() })
	} catch {
		return BooleanResponse.create({ value: false })
	}
}
