import { searchWorkspaceFiles, searchWorkspaceFilesMultiroot } from "@services/search/file-search"
import { telemetryService } from "@services/telemetry"
import { FileSearchRequest, FileSearchResults, FileSearchType } from "@shared/proto/cline/file"
import { convertSearchResultsToProtoFileInfos } from "@shared/proto-conversions/file/search-result-conversion"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."

/**
 * Searches for files in the workspace with fuzzy matching
 * @param controller The controller instance
 * @param request The request containing search query, and optionally a mentionsRequestId and workspace_hint
 * @returns Results containing matching files/folders
 */
export async function searchFiles(controller: Controller, request: FileSearchRequest): Promise<FileSearchResults> {
	try {
		// Map enum to string for the search service
		let selectedTypeString: "file" | "folder" | undefined
		if (request.selectedType === FileSearchType.FILE) {
			selectedTypeString = "file"
		} else if (request.selectedType === FileSearchType.FOLDER) {
			selectedTypeString = "folder"
		}

		// Extract hint, ensure workspaceManager is ready, check for multiroot
		const workspaceHint = request.workspaceHint
		const workspaceManager = await controller.ensureWorkspaceManager()
		const hasMultirootSupport = workspaceManager && workspaceManager.getRoots()?.length > 0

		let searchResults: Array<{ path: string; type: "file" | "folder"; label?: string; workspaceName?: string }>

		if (hasMultirootSupport) {
			searchResults = await searchWorkspaceFilesMultiroot(
				request.query || "",
				workspaceManager,
				request.limit || 20,
				selectedTypeString,
				workspaceHint,
			)
		} else {
			// Legacy single workspace search
			const workspacePath = await getWorkspacePath()

			if (!workspacePath) {
				console.error("Error in searchFiles: No workspace path available")
				await telemetryService.captureMentionFailed("folder", "not_found", "No workspace path available")
				return { results: [], mentionsRequestId: request.mentionsRequestId }
			}

			// Call file search service with query from request
			searchResults = await searchWorkspaceFiles(
				request.query || "",
				workspacePath,
				request.limit || 20, // Use default limit of 20 if not specified
				selectedTypeString,
			)
		}

		// Convert search results to proto FileInfo objects using the conversion function
		const protoResults = convertSearchResultsToProtoFileInfos(searchResults)

		// Track search results telemetry
		// Determine search type for telemetry
		let searchType: "file" | "folder" | "all" = "all"
		if (request.selectedType === FileSearchType.FILE) {
			searchType = "file"
		} else if (request.selectedType === FileSearchType.FOLDER) {
			searchType = "folder"
		}

		await telemetryService.captureMentionSearchResults(
			request.query || "",
			protoResults.length,
			searchType,
			protoResults.length === 0,
		)

		// Return successful results
		return { results: protoResults, mentionsRequestId: request.mentionsRequestId }
	} catch (error) {
		// Log the error but don't include it in the response, following the pattern in searchCommits
		console.error("Error in searchFiles:", error)

		// Track as a search execution error with appropriate error type
		const errorMessage = error instanceof Error ? error.message : String(error)
		const errorType = error instanceof Error && error.message.includes("permission") ? "permission_denied" : "unknown"

		// Determine mention type based on the search request
		const mentionType =
			request.selectedType === FileSearchType.FILE
				? "file"
				: request.selectedType === FileSearchType.FOLDER
					? "folder"
					: "folder" // Default to folder for "all" searches

		await telemetryService.captureMentionFailed(mentionType, errorType, errorMessage)

		// Return empty results without error message
		return { results: [], mentionsRequestId: request.mentionsRequestId }
	}
}
