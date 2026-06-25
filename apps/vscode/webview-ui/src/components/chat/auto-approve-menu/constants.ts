import { ActionMetadata } from "./types"

export const ACTION_METADATA: ActionMetadata[] = [
	{
		id: "readFiles",
		label: "Read project files",
		shortName: "Read",
		icon: "codicon-search",
		subAction: {
			id: "readFilesExternally",
			label: "Read all files",
			shortName: "Read (all)",
			icon: "codicon-folder-opened",
			parentActionId: "readFiles",
		},
	},
	{
		id: "editFiles",
		label: "Edit project files",
		shortName: "Edit",
		icon: "codicon-edit",
		subAction: {
			id: "editFilesExternally",
			label: "Edit all files",
			shortName: "Edit (all)",
			icon: "codicon-files",
			parentActionId: "editFiles",
		},
	},
	{
		id: "executeSafeCommands",
		label: "Execute commands",
		shortName: "Commands",
		icon: "codicon-terminal",
	},
	{
		id: "useBrowser",
		label: "Fetch web content",
		shortName: "Web Fetch",
		icon: "codicon-globe",
	},
	{
		id: "useMcp",
		label: "Use MCP servers",
		shortName: "MCP",
		icon: "codicon-server",
	},
]
