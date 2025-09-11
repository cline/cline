/**
 * Generate and export command identifiers based on the extension name.
 * This allows for flexibility if the extension is published with a different name.
 */
export function getClineCommands(extensionName: string) {
	const prefix = extensionName === "claude-dev" ? "cline" : extensionName
	return {
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
}
