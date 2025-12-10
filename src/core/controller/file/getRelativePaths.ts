import { RelativePaths, RelativePathsRequest } from "@shared/proto/cline/file"
import * as path from "path"
import { URI } from "vscode-uri"
import { isDirectory } from "@/utils/fs"
import { asRelativePath } from "@/utils/path"
import { Controller } from ".."

/**
 * Converts a list of URIs to workspace-relative paths
 * @param controller The controller instance
 * @param request The request containing URIs to convert
 * @returns Response with resolved relative paths
 */
export async function getRelativePaths(_controller: Controller, request: RelativePathsRequest): Promise<RelativePaths> {
	const result = []
	for (const uriString of request.uris) {
		try {
			result.push(await getRelativePath(uriString))
		} catch (error) {
			console.error(`Error calculating relative path for ${uriString}:`, error)
		}
	}
	return RelativePaths.create({ paths: result })
}

async function getRelativePath(uriString: string): Promise<string> {
	const filePath = URI.parse(uriString, true).fsPath
	const relativePath = await asRelativePath(filePath)

	// If the path is still absolute, it's outside the workspace
	if (path.isAbsolute(relativePath)) {
		throw new Error(`Dropped file ${relativePath} is outside the workspace.`)
	}

	let result = "/" + relativePath.replace(/\\/g, "/")
	if (await isDirectory(filePath)) {
		result += "/"
	}
	return result
}
