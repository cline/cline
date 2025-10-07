import { FileInfo } from "@shared/proto/cline/file"

/**
 * Converts domain search result objects to proto FileInfo objects
 */
export function convertSearchResultsToProtoFileInfos(
	results: { path: string; type: "file" | "folder"; label?: string; workspaceName?: string }[],
): FileInfo[] {
	return results.map((result) => ({
		path: result.path,
		type: result.type,
		label: result.label,
		workspaceName: result.workspaceName,
	}))
}

/**
 * Converts proto FileInfo objects to domain search result objects
 */
export function convertProtoFileInfosToSearchResults(
	protoResults: FileInfo[],
): { path: string; type: "file" | "folder"; label?: string; workspaceName?: string }[] {
	return protoResults.map((protoResult) => ({
		path: protoResult.path,
		type: protoResult.type as "file" | "folder",
		label: protoResult.label,
		workspaceName: protoResult.workspaceName,
	}))
}
