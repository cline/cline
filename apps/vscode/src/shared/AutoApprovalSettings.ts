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
		readFiles: boolean // Read files and directories
		readFilesExternally?: boolean // Legacy field - kept for backward compatibility with older extension versions
		editFiles: boolean // Edit files
		editFilesExternally?: boolean // Legacy field - kept for backward compatibility with older extension versions
		executeSafeCommands?: boolean // Legacy field - kept for backward compatibility with older extension versions
		executeAllCommands?: boolean // Execute commands
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
		readFilesExternally: true,
		editFiles: false,
		editFilesExternally: true,
		executeSafeCommands: true,
		executeAllCommands: true,
		useBrowser: false,
		useMcp: true,
	},
	enableNotifications: false,
}

export type AutoApprovalSettingsUpdate = Omit<Partial<AutoApprovalSettings>, "actions"> & {
	actions?: Partial<AutoApprovalSettings["actions"]>
}

export function normalizeAutoApprovalSettings(settings?: AutoApprovalSettingsUpdate): AutoApprovalSettings {
	const incomingActions = settings?.actions ?? {}
	const actions = {
		...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
		...incomingActions,
	}

	if (incomingActions.executeSafeCommands === true) {
		actions.executeAllCommands = true
	} else if (incomingActions.executeAllCommands === undefined && incomingActions.executeSafeCommands === false) {
		actions.executeAllCommands = false
	}

	return {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		...settings,
		actions,
	}
}

export function mergeAutoApprovalSettings(
	base: AutoApprovalSettings,
	incoming?: AutoApprovalSettingsUpdate,
): AutoApprovalSettings {
	const incomingActions = {
		...(incoming?.actions ?? {}),
	}

	if (incomingActions.executeAllCommands !== undefined) {
		incomingActions.executeSafeCommands = incomingActions.executeAllCommands
	}

	return normalizeAutoApprovalSettings({
		...base,
		...incoming,
		actions: {
			...base.actions,
			...incomingActions,
		},
	})
}
