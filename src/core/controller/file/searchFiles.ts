import { FileSearchRequest, FileSearchResults, FileSearchType } from "@shared/proto/cline/file"
import { SearchWorkspaceItemsRequest_SearchItemType } from "@shared/proto/host/workspace"
import { convertSearchResultsToProtoFileInfos } from "@shared/proto-conversions/file/search-result-conversion"
import { getWorkspacePath } from "@utils/path"
import { HostProvider } from "@/hosts/host-provider"
import { Controller } from ".."

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
		// Map enum to host SearchItemType (0 = FILE, 1 = FOLDER)
		const selectedTypeValue: SearchWorkspaceItemsRequest_SearchItemType | undefined =
			request.selectedType === FileSearchType.FILE
				? SearchWorkspaceItemsRequest_SearchItemType.FILE
				: request.selectedType === FileSearchType.FOLDER
					? SearchWorkspaceItemsRequest_SearchItemType.FOLDER
					: undefined

		// Use host-provided search via hostbridge (no fallback)
		const hostResponse = await HostProvider.workspace.searchWorkspaceItems({
			query: request.query || "",
			limit: request.limit || 20,
			selectedType: selectedTypeValue,
		})

		const mapped: { path: string; type: "file" | "folder"; label?: string }[] = (hostResponse.items || []).map(
			(item: { path?: string; type: SearchWorkspaceItemsRequest_SearchItemType; label?: string }) => ({
				path: String(item.path || ""),
				type: item.type === SearchWorkspaceItemsRequest_SearchItemType.FOLDER ? "folder" : "file",
				label: item.label || undefined,
			}),
		)

		const protoResults = convertSearchResultsToProtoFileInfos(mapped)

		return FileSearchResults.create({
			results: protoResults,
			mentionsRequestId: request.mentionsRequestId,
		})
	} catch (error) {
		console.error("Error in host searchWorkspaceItems:", error instanceof Error ? error.message : String(error))
		return FileSearchResults.create({
			results: [],
			mentionsRequestId: request.mentionsRequestId,
		})
	}
}
