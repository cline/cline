import { FileInfo } from "@shared/proto/bedrock_coder/file"

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
