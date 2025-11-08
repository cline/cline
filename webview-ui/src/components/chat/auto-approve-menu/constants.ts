import { ActionMetadata } from "./types"

export const ACTION_METADATA: ActionMetadata[] = [
	{
		id: "readFiles",
		label: "auto_approve.read_project_files",
		shortName: "auto_approve.read",
		description: "auto_approve.read_description",
		icon: "codicon-search",
		subAction: {
			id: "readFilesExternally",
			label: "auto_approve.read_all_files",
			shortName: "auto_approve.read_all",
			description: "auto_approve.read_all_description",
			icon: "codicon-folder-opened",
			parentActionId: "readFiles",
		},
	},
	{
		id: "editFiles",
		label: "auto_approve.edit_project_files",
		shortName: "auto_approve.edit",
		description: "auto_approve.edit_description",
		icon: "codicon-edit",
		subAction: {
			id: "editFilesExternally",
			label: "auto_approve.edit_all_files",
			shortName: "auto_approve.edit_all",
			description: "auto_approve.edit_all_description",
			icon: "codicon-files",
			parentActionId: "editFiles",
		},
	},
	{
		id: "executeSafeCommands",
		label: "auto_approve.execute_safe_commands",
		shortName: "auto_approve.safe_commands",
		description: "auto_approve.execute_safe_description",
		icon: "codicon-terminal",
		subAction: {
			id: "executeAllCommands",
			label: "auto_approve.execute_all_commands",
			shortName: "auto_approve.all_commands",
			description: "auto_approve.execute_all_description",
			icon: "codicon-terminal-bash",
			parentActionId: "executeSafeCommands",
		},
	},
	{
		id: "useBrowser",
		label: "auto_approve.use_browser",
		shortName: "auto_approve.browser",
		description: "auto_approve.browser_description",
		icon: "codicon-globe",
	},
	{
		id: "useMcp",
		label: "auto_approve.use_mcp",
		shortName: "auto_approve.mcp",
		description: "auto_approve.mcp_description",
		icon: "codicon-server",
	},
]

export const NOTIFICATIONS_SETTING: ActionMetadata = {
	id: "enableNotifications",
	label: "auto_approve.enable_notifications",
	shortName: "auto_approve.notifications",
	description: "auto_approve.notifications_description",
	icon: "codicon-bell",
}
