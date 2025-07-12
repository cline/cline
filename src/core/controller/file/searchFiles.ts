import { Controller } from ".."
import { FileSearchRequest, FileSearchResults } from "@shared/proto/file"
import { searchWorkspaceFiles } from "@services/search/file-search"
import { searchWorkspaceFiles as searchWorkspaceFilesUtils } from "@utils/workspace"
import { getWorkspacePath } from "@utils/path"
import { FileMethodHandler } from "./index"
import { convertSearchResultsToProtoFileInfos } from "@shared/proto-conversions/file/search-result-conversion"

/**
 * Searches for files in the workspace with fuzzy matching
 * @param controller The controller instance
 * @param request The request containing search query and optionally a mentionsRequestId
 * @returns Results containing matching files/folders
 */
export const searchFiles: FileMethodHandler = async (
	_controller: Controller,
	request: FileSearchRequest,
): Promise<FileSearchResults> => {
	const workspacePath = await getWorkspacePath()

	if (!workspacePath) {
		// Handle case where workspace path is not available
		console.error("Error in searchFiles: No workspace path available")
		return FileSearchResults.create({
			results: [],
			mentionsRequestId: request.mentionsRequestId,
		})
	}

	try {
		// Try host bridge first (for standalone mode), fall back to ripgrep
		let searchResults: { path: string; type: "file" | "folder"; label?: string; score?: number }[]

		try {
			// Try using host bridge workspace utils first
			searchResults = await searchWorkspaceFilesUtils(request.query || "", request.limit || 20, workspacePath)
			console.log(`Host bridge search found ${searchResults.length} results`)
		} catch (hostBridgeError) {
			console.log(
				"Host bridge search failed, falling back to ripgrep:",
				hostBridgeError instanceof Error ? hostBridgeError.message : String(hostBridgeError),
			)

			// Fallback to ripgrep-based search
			searchResults = await searchWorkspaceFiles(request.query || "", workspacePath, request.limit || 20)
		}

		// Convert search results to proto FileInfo objects using the conversion function
		const protoResults = convertSearchResultsToProtoFileInfos(searchResults)

		// Return successful results
		return FileSearchResults.create({
			results: protoResults,
			mentionsRequestId: request.mentionsRequestId,
		})
	} catch (error) {
		// Log the error but don't include it in the response, following the pattern in searchCommits
		console.error("Error in searchFiles:", error instanceof Error ? error.message : String(error))

		// Return empty results without error message
		return FileSearchResults.create({
			results: [],
			mentionsRequestId: request.mentionsRequestId,
		})
	}
}
