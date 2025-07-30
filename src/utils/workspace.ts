import * as vscode from "vscode"
import { globby } from "globby"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Finds files in the workspace matching the given pattern (Native Cline Core implementation)
 * Uses filesystem operations independent of host environment
 * @param includePattern Glob pattern to search for files
 * @param excludePattern Optional glob pattern to exclude files
 * @param maxResults Maximum number of files to return
 * @param workspacePath Optional workspace path to search in
 * @returns Promise resolving to array of file URIs
 * @throws Error if the operation fails
 */
export async function findFiles(
	includePattern: string,
	excludePattern?: string,
	maxResults?: number,
	workspacePath?: string,
): Promise<vscode.Uri[]> {
	try {
		// Get workspace paths to determine search root
		let searchRoot: string
		if (workspacePath) {
			searchRoot = workspacePath
		} else {
			// Get workspace paths from host bridge
			const workspaceResponse = await HostProvider.workspace.getWorkspacePaths({})
			const workspacePaths = workspaceResponse.paths
			if (workspacePaths.length === 0) {
				return []
			}
			searchRoot = workspacePaths[0]
		}

		// Build glob patterns
		const patterns = [includePattern]
		const ignorePatterns = excludePattern ? [excludePattern] : []

		// Use globby for native filesystem search
		const foundFiles = await globby(patterns, {
			cwd: searchRoot,
			ignore: ignorePatterns,
			absolute: true,
			dot: false,
			onlyFiles: true,
		})

		// Apply max results limit
		const limitedFiles = maxResults ? foundFiles.slice(0, maxResults) : foundFiles

		// Convert to VSCode URIs
		return limitedFiles.map((filePath) => vscode.Uri.file(filePath))
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to find files: ${errorMessage}`)
	}
}
