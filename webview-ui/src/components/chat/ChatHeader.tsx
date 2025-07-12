import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"

const ChatHeader = () => {
	const { navigateToSettings, navigateToHistory, navigateToAccount, navigateToMcp } = useExtensionState()

	return (
		<div className="flex justify-between items-center mb-[17px] pr-[17px] pl-[20px] pt-[10px]">
			<h3 className="text-[var(--vscode-foreground)] m-0">Cline</h3>
			<div className="flex gap-2">
				<VSCodeButton appearance="icon" onClick={() => navigateToMcp()} title="MCP Servers">
					<span className="codicon codicon-server"></span>
				</VSCodeButton>
				<VSCodeButton appearance="icon" onClick={navigateToHistory} title="History">
					<span className="codicon codicon-history"></span>
				</VSCodeButton>
				<VSCodeButton appearance="icon" onClick={navigateToAccount} title="Account">
					<span className="codicon codicon-account"></span>
				</VSCodeButton>
				<VSCodeButton appearance="icon" onClick={navigateToSettings} title="Settings">
					<span className="codicon codicon-gear"></span>
				</VSCodeButton>
			</div>
		</div>
	)
}

export default ChatHeader
