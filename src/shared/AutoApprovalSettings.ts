/**
 * Auto-approval settings for AI assistant actions.
 *
 * This module defines settings that control which actions an AI assistant can perform
 * without requiring explicit user approval. These settings help balance productivity
 * and security by allowing trusted operations to proceed automatically while still
 * maintaining control over sensitive operations.
 *
 * Auto-approval should be used carefully as it reduces the security barrier between
 * the AI assistant and your system. When enabled, actions can be performed without
 * direct user intervention, which improves workflow efficiency but increases risk.
 */

/**
 * Interface defining all auto-approval configuration options.
 *
 * These settings control which actions an AI assistant can perform without
 * explicit user confirmation, as well as global limits and notification preferences.
 */
export interface AutoApprovalSettings {
	/**
	 * Master switch to enable or disable all auto-approvals.
	 * When false, all actions require manual approval regardless of other settings.
	 */
	enabled: boolean

	/**
	 * Individual permissions for different types of actions.
	 * Each action type can be independently enabled or disabled.
	 */
	actions: {
		/**
		 * Whether the assistant can read files and directories without approval.
		 * This gives the assistant access to view files in your workspace.
		 */
		readFiles: boolean

		/**
		 * Whether the assistant can edit files without approval.
		 * This allows the assistant to create, modify, or delete files in your workspace.
		 */
		editFiles: boolean

		/**
		 * Whether the assistant can execute commands without approval.
		 * This allows running terminal commands on your system.
		 * Note: Only commands considered "safe" are eligible for auto-approval.
		 */
		executeCommands: boolean

		/**
		 * Whether the assistant can use the browser without approval.
		 * This allows the assistant to search the web and access online resources.
		 */
		useBrowser: boolean

		/**
		 * Whether the assistant can use Model Control Protocol servers without approval.
		 * This allows the assistant to interact with configured MCP tools and resources.
		 */
		useMcp: boolean
	}

	/**
	 * Maximum number of requests that can be auto-approved in a single session.
	 * Once this limit is reached, all subsequent actions will require manual approval.
	 * This provides a safeguard against unlimited automated actions.
	 */
	maxRequests: number

	/**
	 * Whether to show notifications when actions are auto-approved or completed.
	 * Enabling this provides visibility into what the assistant is doing without
	 * requiring manual approval for each action.
	 */
	enableNotifications: boolean
}

/**
 * Default auto-approval settings (conservative security profile).
 *
 * By default, all auto-approvals are disabled for security, requiring manual
 * confirmation for all actions. These defaults can be overridden by user configuration.
 *
 * The maxRequests limit of 20 provides a reasonable cap on automated actions
 * if auto-approval is enabled by the user.
 */
export const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApprovalSettings = {
	enabled: false,
	actions: {
		readFiles: false,
		editFiles: false,
		executeCommands: false,
		useBrowser: false,
		useMcp: false,
	},
	maxRequests: 20,
	enableNotifications: false,
}
