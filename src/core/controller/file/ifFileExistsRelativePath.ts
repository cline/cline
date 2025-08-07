import * as path from "path"
import * as fs from "fs/promises"
import { Controller } from ".."
import { StringRequest, BooleanResponse } from "@shared/proto/cline/common"
import { getWorkspacePath } from "@utils/path"

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

	try {
		// Resolve the relative path to absolute path
		const absolutePath = path.resolve(workspacePath, request.value)

		// Check if the file exists
		await fs.access(absolutePath)

		return BooleanResponse.create({ value: true })
	} catch (error) {
		// File doesn't exist or access is denied
		return BooleanResponse.create({ value: false })
	}
}
