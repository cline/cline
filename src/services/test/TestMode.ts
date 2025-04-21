/**
 * Module for managing test mode state across the extension
 * This provides a centralized way to check if the extension is running in test mode
 * instead of relying on process.env which may not be consistent across different parts of the extension
 */

let isTestMode = false

/**
 * Sets the test mode state
 * @param value Whether test mode is enabled
 */
export function setTestMode(value: boolean): void {
	isTestMode = value
}

/**
 * Checks if the extension is running in test mode
 * @returns True if in test mode, false otherwise
 */
export function isInTestMode(): boolean {
	return isTestMode
}
