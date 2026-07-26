export interface AutoApprovalSettings {
	// Version for race condition prevention (incremented on every change)
	version: number
	// Legacy field - kept for backward compatibility with older extension versions
	// Retained only to read and discard state written by older extension versions.
	enabled: boolean
	// Legacy field - kept for backward compatibility with older extension versions
	// Favorites feature has been removed
	favorites: string[]
	// Legacy field - kept for backward compatibility with older extension versions
	// Max requests limit feature has been removed
	maxRequests: number
	// Individual action permissions
	actions: {
		readFiles: boolean // Read files and directories
		readFilesExternally?: boolean // Legacy field - kept for backward compatibility with older extension versions
		editFiles: boolean // Edit files
		editFilesExternally?: boolean // Legacy field - kept for backward compatibility with older extension versions
		executeSafeCommands?: boolean // Execute commands
		executeAllCommands?: boolean // Legacy field - kept for backward compatibility with older extension versions
		useBrowser: boolean // Use browser
		useMcp: boolean // Use MCP servers
	}
	// Global settings
	enableNotifications: boolean // Show notifications for approval and task completion
}

export const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApprovalSettings = {
	version: 1,
	enabled: false,
	favorites: [], // Legacy field - kept as empty array
	maxRequests: 20, // Legacy field - kept for backward compatibility
	actions: {
		readFiles: true,
		readFilesExternally: true,
		editFiles: false,
		editFilesExternally: false,
		executeSafeCommands: false,
		executeAllCommands: false,
		useBrowser: false,
		useMcp: false,
	},
	enableNotifications: false,
}
