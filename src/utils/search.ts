import { getHostBridgeProvider } from "@/hosts/host-providers"
import { RegexSearchRequest, WorkspaceSearchRequest } from "@shared/proto/host/search"
import { String, EmptyRequest } from "@shared/proto/common"
import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"

/**
 * Performs regex search on files using the host's search implementation
 * @param cwd The current working directory (for relative path calculation)
 * @param directoryPath The directory to search in
 * @param regex The regular expression to search for (Rust regex syntax)
 * @param filePattern Optional glob pattern to filter files (default: '*')
 * @param clineIgnoreController Optional ignore controller for filtering results
 * @returns Promise resolving to formatted search results
 */
export async function regexSearchFiles(
	cwd: string,
	directoryPath: string,
	regex: string,
	filePattern?: string,
	clineIgnoreController?: ClineIgnoreController,
): Promise<string> {
	// Convert ClineIgnoreController to ignore patterns array
	const ignorePatterns: string[] = []
	// TODO: Implement conversion from ClineIgnoreController to string patterns
	// This will need to be done when copying the actual logic

	const response = await getHostBridgeProvider().searchClient.regexSearchFiles(
		RegexSearchRequest.create({
			cwd,
			directoryPath,
			regex,
			filePattern,
			ignorePatterns,
		}),
	)

	return response.value
}

/**
 * Searches workspace files with fuzzy matching
 * @param query The search query string
 * @param workspacePath The workspace directory path
 * @param limit Maximum number of results to return (default: 20)
 * @returns Promise resolving to array of search results
 */
export async function searchWorkspaceFiles(
	query: string,
	workspacePath: string,
	limit: number = 20,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	const response = await getHostBridgeProvider().searchClient.searchWorkspaceFiles(
		WorkspaceSearchRequest.create({
			query,
			workspacePath,
			limit,
		}),
	)

	return response.results.map((r) => ({
		path: r.path,
		type: r.type as "file" | "folder",
		label: r.label,
	}))
}

/**
 * Gets the path to the search binary (for RipGrep-based implementations)
 * @param appRoot The application root directory path
 * @returns Promise resolving to the binary path
 */
export async function getBinPath(appRoot: string): Promise<string | undefined> {
	const response = await getHostBridgeProvider().searchClient.getBinPath(String.create({ value: appRoot }))

	return response.value || undefined
}
