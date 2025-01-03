import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"

const McpEnabledToggle = () => {
	const { mcpEnabled, setMcpEnabled } = useExtensionState()

	return (
		<div style={{ marginBottom: "20px" }}>
			<VSCodeCheckbox
				checked={mcpEnabled}
				onChange={(e: any) => {
					setMcpEnabled(e.target.checked)
					vscode.postMessage({ type: "mcpEnabled", bool: e.target.checked })
				}}>
				<span style={{ fontWeight: "500" }}>Enable MCP Servers</span>
			</VSCodeCheckbox>
			<p style={{
				fontSize: "12px",
				marginTop: "5px",
				color: "var(--vscode-descriptionForeground)",
			}}>
				When enabled, Cline will be able to interact with MCP servers for advanced functionality. If you're not using MCP, you can disable this to reduce Cline's token usage.
			</p>
		</div>
	)
}

export default McpEnabledToggle