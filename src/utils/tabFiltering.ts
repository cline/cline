import { fileExistsAtPath } from "./fs"

/**
 * Filters file paths to exclude deleted files from disk
 * @param filePaths Array of file system paths to filter
 * @returns Promise resolving to array of existing file paths
 */
export async function filterExistingFiles(filePaths: string[]): Promise<string[]> {
	const filteredPaths: string[] = []

	for (const filePath of filePaths) {
		if (!filePath) {
			continue
		}
		if (await fileExistsAtPath(filePath)) {
			filteredPaths.push(filePath)
		}
	}
	return filteredPaths
}
