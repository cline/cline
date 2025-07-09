import * as vscode from "vscode"

/**
 * Finds files in the workspace matching the given pattern (Native implementation)
 * @param includePattern Glob pattern to search for files
 * @param excludePattern Optional glob pattern to exclude files
 * @param maxResults Maximum number of files to return
 * @returns Promise resolving to array of file URIs
 * @throws Error if the operation fails
 */
export async function findFiles(includePattern: string, excludePattern?: string, maxResults?: number): Promise<vscode.Uri[]> {
	try {
		const relativePattern = new vscode.RelativePattern(
			vscode.workspace.workspaceFolders?.[0] ?? vscode.Uri.file("."),
			includePattern,
		)
		const excludeGlob = excludePattern
			? new vscode.RelativePattern(vscode.workspace.workspaceFolders?.[0] ?? vscode.Uri.file("."), excludePattern)
			: undefined

		return await vscode.workspace.findFiles(relativePattern, excludeGlob, maxResults)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to find files: ${errorMessage}`)
	}
}
