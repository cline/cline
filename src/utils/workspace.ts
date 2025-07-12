import * as vscode from "vscode"
import * as path from "path"
import { globby } from "globby"
import { getHostBridgeProvider } from "@/hosts/host-providers"
import { Metadata } from "@/shared/proto/common"
import { WorkspaceFileType } from "@/shared/proto/host/workspace"

/**
 * Finds files in the workspace matching the given pattern (Native Cline Core implementation)
 * Uses filesystem operations independent of host environment
 * @param includePattern Glob pattern to search for files
 * @param excludePattern Optional glob pattern to exclude files
 * @param maxResults Maximum number of files to return
 * @param workspacePath Optional workspace path to search in
 * @returns Promise resolving to array of file URIs
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
			const workspaceResponse = await getHostBridgeProvider().workspaceClient.getWorkspacePaths({})
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

/**
 * Searches for files in the workspace with fuzzy matching
 * @param query Search query string
 * @param limit Maximum number of results to return
 * @param workspacePath Optional workspace path to search in
 * @returns Promise resolving to array of search results
 */
export async function searchWorkspaceFiles(
	query: string,
	limit?: number,
	workspacePath?: string,
): Promise<{ path: string; type: "file" | "folder"; label?: string; score?: number }[]> {
	try {
		const response = await getHostBridgeProvider().workspaceClient.searchFiles({
			metadata: Metadata.create(),
			query,
			limit,
			workspacePath,
		})

		return response.results.map((result) => ({
			path: result.path,
			type: result.type === WorkspaceFileType.WORKSPACE_FILE_TYPE_FOLDER ? "folder" : "file",
			label: result.label,
			score: result.score,
		}))
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to search workspace files: ${errorMessage}`)
	}
}

/**
 * Gets the workspace paths
 * @param id Optional workspace ID
 * @returns Promise resolving to array of workspace paths
 */
export async function getWorkspacePaths(id?: string): Promise<string[]> {
	try {
		const response = await getHostBridgeProvider().workspaceClient.getWorkspacePaths({
			id,
		})
		return response.paths
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to get workspace paths: ${errorMessage}`)
	}
}

/**
 * Direct VSCode API fallback for finding files
 */
export async function findFilesVSCode(
	includePattern: string,
	excludePattern?: string,
	maxResults?: number,
): Promise<vscode.Uri[]> {
	const relativePattern = new vscode.RelativePattern(
		vscode.workspace.workspaceFolders?.[0] ?? vscode.Uri.file("."),
		includePattern,
	)
	const excludeGlob = excludePattern
		? new vscode.RelativePattern(vscode.workspace.workspaceFolders?.[0] ?? vscode.Uri.file("."), excludePattern)
		: undefined

	return await vscode.workspace.findFiles(relativePattern, excludeGlob, maxResults)
}

/**
 * Direct VSCode API fallback for getting workspace paths
 */
export function getWorkspacePathsVSCode(): string[] {
	return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []
}
