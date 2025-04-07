export interface AutoApprovalSettings {
    // Individual action permissions
    actions: {
        readFiles: boolean // Read files and directories
        editFiles: boolean // Edit files
        executeCommands: boolean // Execute safe commands
        useBrowser: boolean // Use browser
        useMcp: boolean // Use MCP servers
    }
    // Global settings
    maxRequests: number // Maximum number of auto-approved requests
    enableNotifications: boolean // Show notifications for approval and task completion
}

export const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApprovalSettings = {
    actions: {
        readFiles: true,
        editFiles: false,
        executeCommands: false,
        useBrowser: true,
        useMcp: false,
    },
    maxRequests: 20,
    enableNotifications: false,
}
