import { RipgrepError, searchWorkspaceFiles, searchWorkspaceFilesMultiroot } from "@services/search/file-search"
import { telemetryService } from "@services/telemetry"
import { FileSearchRequest, FileSearchResults, FileSearchType } from "@shared/proto/cline/file"
import { convertSearchResultsToProtoFileInfos } from "@shared/proto-conversions/file/search-result-conversion"
import { getWorkspacePath } from "@utils/path"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

// error_reason values surfaced on FileSearchResults; see proto/cline/file.proto.
const ERROR_REASON_WORKSPACE_UNAVAILABLE = "workspace_unavailable"
const ERROR_REASON_RIPGREP_SPAWN_FAILED = "ripgrep_spawn_failed"
const ERROR_REASON_UNKNOWN = "unknown"

function classifyError(error: unknown): { errorReason: string; errorMessage: string } {
	const errorMessage = error instanceof Error ? error.message : String(error)
	if (error instanceof RipgrepError) {
		const firstStderrLine = error.stderr ? error.stderr.trim().split("\n", 1)[0] : ""
		return {
			errorReason: ERROR_REASON_RIPGREP_SPAWN_FAILED,
			errorMessage: firstStderrLine || errorMessage,
		}
	}
	return { errorReason: ERROR_REASON_UNKNOWN, errorMessage }
}

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
				Logger.error("Error in searchFiles: No workspace path available")
				telemetryService.captureMentionFailed(
					"folder",
					"workspace_unavailable",
					"No workspace path available",
				)
				return {
					results: [],
					mentionsRequestId: request.mentionsRequestId,
					errorReason: ERROR_REASON_WORKSPACE_UNAVAILABLE,
					errorMessage: "No workspace path available",
				}
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
		const { errorReason, errorMessage } = classifyError(error)
		Logger.error(`Error in searchFiles (errorReason=${errorReason}):`, error)

		const mentionType =
			request.selectedType === FileSearchType.FILE
				? "file"
				: request.selectedType === FileSearchType.FOLDER
					? "folder"
					: "folder" // Default to folder for "all" searches

		const errorType: "ripgrep_spawn_failed" | "permission_denied" | "unknown" =
			errorReason === ERROR_REASON_RIPGREP_SPAWN_FAILED
				? "ripgrep_spawn_failed"
				: error instanceof Error && error.message.includes("permission")
					? "permission_denied"
					: "unknown"

		await telemetryService.captureMentionFailed(mentionType, errorType, errorMessage)

		return {
			results: [],
			mentionsRequestId: request.mentionsRequestId,
			errorReason,
			errorMessage,
		}
	}
}
