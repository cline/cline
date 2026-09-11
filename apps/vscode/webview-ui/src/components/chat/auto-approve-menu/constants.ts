import { ActionMetadata } from "./types"

// `label` and `shortName` hold i18n keys; call `t()` at the render site.
export const ACTION_METADATA: ActionMetadata[] = [
	{
		id: "readFiles",
		label: "autoApprove:actions.readFiles.label",
		shortName: "autoApprove:actions.readFiles.shortName",
		icon: "codicon-search",
	},
	{
		id: "editFiles",
		label: "autoApprove:actions.editFiles.label",
		shortName: "autoApprove:actions.editFiles.shortName",
		icon: "codicon-edit",
	},
	{
		id: "executeSafeCommands",
		label: "autoApprove:actions.executeSafeCommands.label",
		shortName: "autoApprove:actions.executeSafeCommands.shortName",
		icon: "codicon-terminal",
	},
	{
		id: "useBrowser",
		label: "autoApprove:actions.useBrowser.label",
		shortName: "autoApprove:actions.useBrowser.shortName",
		icon: "codicon-globe",
	},
	{
		id: "useMcp",
		label: "autoApprove:actions.useMcp.label",
		shortName: "autoApprove:actions.useMcp.shortName",
		icon: "codicon-server",
	},
]
