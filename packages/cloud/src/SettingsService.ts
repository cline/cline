import type { OrganizationAllowList, OrganizationSettings } from "@roo-code/types"

/**
 * Interface for settings services that provide organization settings
 */
export interface SettingsService {
	/**
	 * Get the organization allow list
	 * @returns The organization allow list or default if none available
	 */
	getAllowList(): OrganizationAllowList

	/**
	 * Get the current organization settings
	 * @returns The organization settings or undefined if none available
	 */
	getSettings(): OrganizationSettings | undefined

	/**
	 * Dispose of the settings service and clean up resources
	 */
	dispose(): void
}
