import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { FormEvent } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"

const McpEnabledToggle = () => {
	const { mcpEnabled, setMcpEnabled } = useExtensionState()

	const handleChange = (e: Event | FormEvent<HTMLElement>) => {
		const target = ('target' in e ? e.target : null) as HTMLInputElement | null
		if (!target) return
		setMcpEnabled(target.checked)
		vscode.postMessage({ type: "mcpEnabled", bool: target.checked })
	}

	return (
		<div style={{ marginBottom: "20px" }}>
			<VSCodeCheckbox
				checked={mcpEnabled}
				onChange={handleChange}>
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