/**
 * Mock setup for Cline tests
 *
 * This file contains centralized mock configurations for services
 * that require special handling in tests. It prevents test failures
 * related to undefined values, missing dependencies, or filesystem access.
 *
 * Services mocked here:
 * - ripgrep: Prevents path.join issues with undefined parameters
 * - list-files: Prevents dependency on actual ripgrep binary
 */

/**
 * Mock the ripgrep service
 * This prevents issues with path.join and undefined parameters in tests
 */
jest.mock("../../services/ripgrep", () => ({
	// Always returns a valid path to the ripgrep binary
	getBinPath: jest.fn().mockResolvedValue("/mock/path/to/rg"),

	// Returns static search results
	regexSearchFiles: jest.fn().mockResolvedValue("Mock search results"),

	// Safe implementation of truncateLine that handles edge cases
	truncateLine: jest.fn().mockImplementation((line: string) => line || ""),
}))

/**
 * Mock the list-files module
 * This prevents dependency on the ripgrep binary and filesystem access
 */
jest.mock("../../services/glob/list-files", () => ({
	// Returns empty file list with boolean flag indicating if limit was reached
	listFiles: jest.fn().mockImplementation(() => {
		return Promise.resolve([[], false])
	}),
}))

export {}
