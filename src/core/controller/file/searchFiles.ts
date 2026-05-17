import {
	type FileSearchSource,
	RipgrepError,
	type SearchWorkspaceFilesResult,
	searchWorkspaceFiles,
	searchWorkspaceFilesMultiroot,
} from "@services/search/file-search"

import { telemetryService } from "@services/telemetry"
import { FileSearchRequest, FileSearchResults, FileSearchType } from "@shared/proto/cline/file"
import { convertSearchResultsToProtoFileInfos } from "@shared/proto-conversions/file/search-result-conversion"
import { type FsInfo, getFsInfo } from "@utils/fs-info"
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

// Fire-and-forget the FS-class lookup + telemetry capture. The picker awaits
// the searchFiles response, so we must not block it on a slow/hung mount —
// `getFsInfo` does a `realpath` and a `mount`/`stat -f` that, even with the
// outer timeout in fs-info, can still cost seconds on a stale network FS.
function captureWithFsContext(fsContextPath: string | undefined, capture: (fsContext: FsInfo) => void | Promise<void>): void {
	getFsInfo(fsContextPath)
		.then(capture)
		.catch((err) => Logger.warn(`searchFiles: telemetry capture failed: ${err}`))
}

/**
 * Searches for files in the workspace with fuzzy matching
 * @param controller The controller instance
 * @param request The request containing search query, and optionally a mentionsRequestId and workspace_hint
 * @returns Results containing matching files/folders
 */
export async function searchFiles(controller: Controller, request: FileSearchRequest): Promise<FileSearchResults> {
	// Best-effort path used for FS-class telemetry. Declared in the function
	// scope so the catch block can also reference it. When the request carries
	// a workspaceHint we tag against the matched root; for cross-root searches
	// (no hint) we fall back to the primary root, since attributing one event
	// to "the root that mattered" is impossible without per-root events.
	let fsContextPath: string | undefined

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
			fsContextPath = hintedRoot?.path ?? workspaceManager.getRoots()[0]?.path
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
				telemetryService.captureMentionFailed("folder", "workspace_unavailable", "No workspace path available")
				return {
					results: [],
					mentionsRequestId: request.mentionsRequestId,
					errorReason: ERROR_REASON_WORKSPACE_UNAVAILABLE,
					errorMessage: "No workspace path available",
				}
			}

			fsContextPath = workspacePath
			// Call file search service with query from request
			searchResult = await searchWorkspaceFiles(
				request.query || "",
				workspacePath,
				request.limit || 20, // Use default limit of 20 if not specified
				selectedTypeString,
			)
		}

		const searchSource: FileSearchSource = searchResult.source

		// Convert search results to proto FileInfo objects using the conversion function
		const protoResults = convertSearchResultsToProtoFileInfos(searchResult.items)

		// Track search results telemetry
		// Determine search type for telemetry
		let searchType: "file" | "folder" | "all" = "all"
		if (request.selectedType === FileSearchType.FILE) {
			searchType = "file"
		} else if (request.selectedType === FileSearchType.FOLDER) {
			searchType = "folder"
		}

		captureWithFsContext(fsContextPath, (fsContext) =>
			telemetryService.captureMentionSearchResults(
				request.query || "",
				protoResults.length,
				searchType,
				protoResults.length === 0,
				fsContext,
				searchSource,
			),
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

		// fsContextPath may be unset if we threw before resolving the workspace;
		// getFsInfo handles undefined and returns the unknown sentinel.
		captureWithFsContext(fsContextPath, (fsContext) =>
			telemetryService.captureMentionFailed(mentionType, errorType, errorMessage, fsContext),
		)

		return {
			results: [],
			mentionsRequestId: request.mentionsRequestId,
			errorReason,
			errorMessage,
		}
	}
}
