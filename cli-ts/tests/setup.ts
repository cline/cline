/**
 * Test setup file for Mocha
 *
 * This file is loaded before all tests run and can be used
 * for global test configuration and utilities.
 */

// Store original console methods for tests that need them
const originalConsole = { ...console }

/**
 * Test utilities for console management
 */
export const testUtils = {
	/**
	 * Restore the original console methods
	 */
	restoreConsole: () => {
		Object.assign(console, originalConsole)
	},

	/**
	 * Silence console output for cleaner test output
	 */
	silenceConsole: () => {
		console.log = () => {}
		console.info = () => {}
		console.debug = () => {}
		console.warn = () => {}
		// Keep console.error for debugging test failures
	},
}
