export interface AutoApprovalSettings {
	// Version for race condition prevention (incremented on every change)
	version: number
	// Legacy field - kept for backward compatibility with older extension versions
	// Auto-approve is now always enabled by default
	enabled: boolean
	// Legacy field - kept for backward compatibility with older extension versions
	// Favorites feature has been removed
	favorites: string[]
	// Legacy field - kept for backward compatibility with older extension versions
	// Max requests limit feature has been removed
	maxRequests: number
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
	enableNotifications: boolean // Show notifications for approval and task completion
}

export const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApprovalSettings = {
	version: 1,
	enabled: true, // Legacy field - always true by default
	favorites: [], // Legacy field - kept as empty array
	maxRequests: 20, // Legacy field - kept for backward compatibility
	actions: {
		readFiles: true,
		readFilesExternally: false,
		editFiles: false,
		editFilesExternally: false,
		executeSafeCommands: true,
		executeAllCommands: false,
		useBrowser: false,
		useMcp: true,
	},
	enableNotifications: false,
}
