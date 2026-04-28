import { RipgrepSpawnError, searchWorkspaceFiles, searchWorkspaceFilesMultiroot } from "@services/search/file-search"
import { telemetryService } from "@services/telemetry"
import { FileSearchRequest, FileSearchResults, FileSearchType } from "@shared/proto/cline/file"
import { convertSearchResultsToProtoFileInfos } from "@shared/proto-conversions/file/search-result-conversion"
import { getWorkspacePath } from "@utils/path"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

// CLINE-1814: closed enumeration of error_reason values surfaced to the picker.
// See proto/cline/file.proto for the full inline documentation. The
// `workspace_not_ready` value is not produced from this controller in Phase 1
// (it requires the JetBrains-side WorkspaceNotReadyError signal added in
// Phase 2A.4); we still document the full enumeration in one place so the
// picker UI in Phase 1.4 can render it as soon as it appears on the wire.
const ERROR_REASON_WORKSPACE_UNAVAILABLE = "workspace_unavailable"
const ERROR_REASON_RIPGREP_SPAWN_FAILED = "ripgrep_spawn_failed"
const ERROR_REASON_UNKNOWN = "unknown"

/**
 * Map a thrown error to a structured `error_reason` + `error_message` pair.
 * Phase 2A.4 will add a WorkspaceNotReadyError translation here; for Phase 1
 * we only know two specific shapes (RipgrepSpawnError, and the
 * "no workspace path" branch which never throws), plus the unknown catch-all.
 */
function classifyError(error: unknown): { errorReason: string; errorMessage: string } {
	const errorMessage = error instanceof Error ? error.message : String(error)
	if (error instanceof RipgrepSpawnError) {
		// Render a short first-line of stderr if any, falling back to the
		// generic message. The picker UI shows this as a grey subtitle so
		// keep it short and human-readable.
		const firstStderrLine = error.stderr ? error.stderr.split("\n", 1)[0] : ""
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
				// CLINE-1814: surface as workspace_unavailable instead of a silent
				// empty list. Phase 2A.4 will additionally distinguish the
				// transient "workspace_not_ready" case for the JetBrains host.
				Logger.error("Error in searchFiles: No workspace path available")
				telemetryService.captureMentionFailed("folder", "not_found", "No workspace path available")
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
		// CLINE-1814: classify the error so the picker UI can render a structured
		// subtitle instead of always showing "no results found".
		Logger.error("Error in searchFiles:", error)

		const { errorReason, errorMessage } = classifyError(error)

		// Existing telemetry channel — keep using it so we don't double-count.
		// captureMentionFailed has a closed enum of error types; map our
		// error_reason values onto its closest equivalent. The plan note in
		// §6 explicitly calls this out: don't invent a parallel telemetry
		// channel; carry the precise reason in `errorMessage` instead.
		const errorType: "permission_denied" | "unknown" =
			error instanceof Error && error.message.includes("permission") ? "permission_denied" : "unknown"

		// Determine mention type based on the search request
		const mentionType =
			request.selectedType === FileSearchType.FILE
				? "file"
				: request.selectedType === FileSearchType.FOLDER
					? "folder"
					: "folder" // Default to folder for "all" searches

		await telemetryService.captureMentionFailed(mentionType, errorType, errorMessage)

		return {
			results: [],
			mentionsRequestId: request.mentionsRequestId,
			errorReason,
			errorMessage,
		}
	}
}
