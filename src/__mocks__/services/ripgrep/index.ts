/**
 * Mock implementation for the ripgrep service
 *
 * This mock provides stable implementations of all ripgrep service functions,
 * making sure to handle undefined values safely to prevent test failures.
 * Each function is documented with its purpose and behavior in tests.
 */

/**
 * Mock implementation of getBinPath
 * Always returns a valid path to avoid path resolution errors in tests
 *
 * @param vscodeAppRoot - Optional VSCode app root path (can be undefined)
 * @returns Promise resolving to a mock path to the ripgrep binary
 */
export const getBinPath = jest.fn().mockImplementation(async (vscodeAppRoot?: string): Promise<string> => {
	return "/mock/path/to/rg"
})

/**
 * Mock implementation of regexSearchFiles
 * Always returns a static search result string to avoid executing real searches
 *
 * @param cwd - Optional working directory (can be undefined)
 * @param directoryPath - Optional directory to search (can be undefined)
 * @param regex - Optional regex pattern (can be undefined)
 * @param filePattern - Optional file pattern (can be undefined)
 * @returns Promise resolving to a mock search result
 */
export const regexSearchFiles = jest
	.fn()
	.mockImplementation(
		async (cwd?: string, directoryPath?: string, regex?: string, filePattern?: string): Promise<string> => {
			return "Mock search results"
		},
	)

/**
 * Mock implementation of truncateLine
 * Returns the input line or empty string if undefined
 *
 * @param line - The line to truncate (can be undefined)
 * @param maxLength - Optional maximum length (can be undefined)
 * @returns The original line or empty string if undefined
 */
export const truncateLine = jest.fn().mockImplementation((line?: string, maxLength?: number): string => {
	return line || ""
})
