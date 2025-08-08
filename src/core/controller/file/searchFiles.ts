import { Controller } from ".."
import { FileSearchRequest, FileSearchResults } from "@shared/proto/cline/file"
import { searchWorkspaceFiles } from "@services/search/file-search"
import { getWorkspacePath } from "@utils/path"
import { convertSearchResultsToProtoFileInfos } from "@shared/proto-conversions/file/search-result-conversion"

/**
 * Searches for files in the workspace with fuzzy matching
 * @param controller The controller instance
 * @param request The request containing search query and optionally a mentionsRequestId
 * @returns Results containing matching files/folders
 */
export async function searchFiles(_controller: Controller, request: FileSearchRequest): Promise<FileSearchResults> {
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
		// Call file search service with query from request
		const searchResults = await searchWorkspaceFiles(
			request.query || "",
			workspacePath,
			request.limit || 20, // Use default limit of 20 if not specified
		)

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
