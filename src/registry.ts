import { name, publisher, version } from "../package.json"

const prefix = name === "claude-dev" ? "cline" : name

/**
 * List of commands with the name of the extension they are registered under.
 */
const ClineCommands = {
	PlusButton: prefix + ".plusButtonClicked",
	McpButton: prefix + ".mcpButtonClicked",
	PopoutButton: prefix + ".popoutButtonClicked",
	OpenInNewTab: prefix + ".openInNewTab",
	SettingsButton: prefix + ".settingsButtonClicked",
	HistoryButton: prefix + ".historyButtonClicked",
	AccountButton: prefix + ".accountButtonClicked",
	TerminalOutput: prefix + ".addTerminalOutputToChat",
	AddToChat: prefix + ".addToChat",
	FixWithCline: prefix + ".fixWithCline",
	ExplainCode: prefix + ".explainCode",
	ImproveCode: prefix + ".improveCode",
	FocusChatInput: prefix + ".focusChatInput",
	Walkthrough: prefix + ".openWalkthrough",
	GenerateCommit: prefix + ".generateGitCommitMessage",
	AbortCommit: prefix + ".abortGitCommitMessage",
}

/**
 * IDs for the views registered by the extension.
 */
const ClineViewIds = {
	Sidebar: prefix + ".SidebarProvider",
	TabPanel: prefix + ".TabPanelProvider",
}

/**
 * The registry info for the extension, including its ID, name, version, commands, and views
 * registered for the current host.
 */
export const ExtensionRegistryInfo = {
	id: publisher + "." + name,
	name,
	version,
	publisher,
	commands: ClineCommands,
	views: ClineViewIds,
}
