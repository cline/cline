/**
 * Mock implementation of list-files module
 *
 * IMPORTANT NOTES:
 * 1. This file must be placed in src/services/glob/__mocks__/ to properly mock the module
 * 2. DO NOT IMPORT any modules from the application code to avoid circular dependencies
 * 3. All dependencies are mocked/stubbed locally for isolation
 *
 * This implementation provides predictable behavior for tests without requiring
 * actual filesystem access or ripgrep binary.
 */

/**
 * Mock function for path resolving without importing path module
 * Provides basic path resolution for testing
 *
 * @param dirPath - Directory path to resolve
 * @returns Absolute mock path
 */
const mockResolve = (dirPath: string): string => {
	return dirPath.startsWith("/") ? dirPath : `/mock/path/${dirPath}`
}

/**
 * Mock implementation of listFiles function
 * Returns different results based on input path for testing different scenarios
 *
 * @param dirPath - Directory path to list files from
 * @param recursive - Whether to list files recursively
 * @param limit - Maximum number of files to return
 * @returns Promise resolving to [file paths, limit reached flag]
 */
export const listFiles = vi.fn((dirPath: string, _recursive: boolean, limit: number) => {
	// Early return for limit of 0 - matches the actual implementation
	if (limit === 0) {
		return Promise.resolve([[], false])
	}

	// Special case: Root or home directories
	// Prevents tests from trying to list all files in these directories
	if (dirPath === "/" || dirPath === "/root" || dirPath === "/home/user") {
		return Promise.resolve([[dirPath], false])
	}

	// Special case: Tree-sitter tests
	// Some tests expect the second value to be a Set instead of a boolean
	if (dirPath.includes("test/path")) {
		return Promise.resolve([[], new Set()])
	}

	// Special case: For testing directories with actual content
	if (dirPath.includes("mock/content")) {
		const mockFiles = [
			`${mockResolve(dirPath)}/file1.txt`,
			`${mockResolve(dirPath)}/file2.js`,
			`${mockResolve(dirPath)}/folder1/`,
		]
		return Promise.resolve([mockFiles, false])
	}

	// Default case: Return empty list for most tests
	return Promise.resolve([[], false])
})
