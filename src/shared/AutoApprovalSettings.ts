export interface AutoApprovalSettings {
	// Whether auto-approval is enabled
	enabled: boolean
	// Individual action permissions
	actions: {
		readFiles: boolean // Read files and directories in the working directory
		readFilesExternally?: boolean // Read files and directories outside of the working directory
		editFiles: boolean // Edit files in the working directory
		editFilesExternally?: boolean // Edit files outside of the working directory
		executeSafeCommands?: boolean // Execute safe commands
		executeAllCommands?: boolean // Execute all commands
		useBrowser: boolean // Use browser
		useMcp: boolean // Use MCP servers
	}
	// Global settings
	maxRequests: number // Maximum number of auto-approved requests
	enableNotifications: boolean // Show notifications for approval and task completion
}

export const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApprovalSettings = {
	enabled: false,
	actions: {
		readFiles: false,
		readFilesExternally: false,
		editFiles: false,
		editFilesExternally: false,
		executeSafeCommands: false,
		executeAllCommands: false,
		useBrowser: false,
		useMcp: false,
	},
	maxRequests: 20,
	enableNotifications: false,
}
