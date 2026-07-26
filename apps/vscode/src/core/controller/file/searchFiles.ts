import {
	RipgrepError,
	type SearchWorkspaceFilesResult,
	searchWorkspaceFiles,
	searchWorkspaceFilesMultiroot,
} from "@services/search/file-search"
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

// the searchFiles response, so we must not block it on a slow/hung mount —
// `getFsInfo` does a `realpath` and a `mount`/`stat -f` that, even with the
// outer timeout in fs-info, can still cost seconds on a stale network FS.
/**
 * Searches for files in the workspace with fuzzy matching
 * @param controller The controller instance
 * @param request The request containing search query, and optionally a mentionsRequestId and workspace_hint
 * @returns Results containing matching files/folders
 */
export async function searchFiles(controller: Controller, request: FileSearchRequest): Promise<FileSearchResults> {
	// scope so the catch block can also reference it. When the request carries
	// a workspaceHint we tag against the matched root; for cross-root searches
	// (no hint) we fall back to the primary root, since attributing one event
	// to "the root that mattered" is impossible without per-root events.
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

		let searchResult: SearchWorkspaceFilesResult

		if (hasMultirootSupport) {
			// Tag the actually-searched root, not always the primary —
			// otherwise an SSHFS secondary root looks like a fast primary
			// in dashboards. searchWorkspaceFilesMultiroot resolves the hint
			// the same way (by name).
			const hintedRoot = workspaceHint
				? (workspaceManager.getRootByName(workspaceHint) ??
					workspaceManager.getRoots().find((r) => r.path === workspaceHint))
				: undefined
			searchResult = await searchWorkspaceFilesMultiroot(
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
				return {
					results: [],
					mentionsRequestId: request.mentionsRequestId,
					errorReason: ERROR_REASON_WORKSPACE_UNAVAILABLE,
					errorMessage: "No workspace path available",
				}
			}

			// Call file search service with query from request
			searchResult = await searchWorkspaceFiles(
				request.query || "",
				workspacePath,
				request.limit || 20, // Use default limit of 20 if not specified
				selectedTypeString,
			)
		}

		// Convert search results to proto FileInfo objects using the conversion function
		const protoResults = convertSearchResultsToProtoFileInfos(searchResult.items)

		// Return successful results
		return { results: protoResults, mentionsRequestId: request.mentionsRequestId }
	} catch (error) {
		const { errorReason, errorMessage } = classifyError(error)
		Logger.error(`Error in searchFiles (errorReason=${errorReason}):`, error)

		// fsContextPath may be unset if we threw before resolving the workspace;
		// getFsInfo handles undefined and returns the unknown sentinel.
		return {
			results: [],
			mentionsRequestId: request.mentionsRequestId,
			errorReason,
			errorMessage,
		}
	}
}
