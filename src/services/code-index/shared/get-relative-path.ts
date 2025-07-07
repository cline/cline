import path from "path"

/**
 * Generates a normalized absolute path from a given file path and workspace root.
 * Handles path resolution and normalization to ensure consistent absolute paths.
 *
 * @param filePath - The file path to normalize (can be relative or absolute)
 * @param workspaceRoot - The root directory of the workspace (required)
 * @returns The normalized absolute path
 */
export function generateNormalizedAbsolutePath(filePath: string, workspaceRoot: string): string {
	// Resolve the path to make it absolute if it's relative
	const resolvedPath = path.resolve(workspaceRoot, filePath)
	// Normalize to handle any . or .. segments and duplicate slashes
	return path.normalize(resolvedPath)
}

/**
 * Generates a relative file path from a normalized absolute path and workspace root.
 * Ensures consistent relative path generation across different platforms.
 *
 * @param normalizedAbsolutePath - The normalized absolute path to convert
 * @param workspaceRoot - The root directory of the workspace (required)
 * @returns The relative path from workspaceRoot to the file
 */
export function generateRelativeFilePath(normalizedAbsolutePath: string, workspaceRoot: string): string {
	// Generate the relative path
	const relativePath = path.relative(workspaceRoot, normalizedAbsolutePath)
	// Normalize to ensure consistent path separators
	return path.normalize(relativePath)
}
