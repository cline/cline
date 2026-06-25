import { ActionMetadata } from "./types"

export const ACTION_METADATA: ActionMetadata[] = [
	{
		id: "readFiles",
		label: "Read files",
		shortName: "Read",
		icon: "codicon-search",
	},
	{
		id: "editFiles",
		label: "Edit files",
		shortName: "Edit",
		icon: "codicon-edit",
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
