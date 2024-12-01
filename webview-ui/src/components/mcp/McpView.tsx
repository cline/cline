import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

type McpViewProps = {
	onDone: () => void
}

const McpView = ({ onDone }: McpViewProps) => {
	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "10px 17px 10px 20px",
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>MCP</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>
			<div style={{ padding: "20px", display: "flex", justifyContent: "center" }}>
				<VSCodeButton>Add Server</VSCodeButton>
			</div>
		</div>
	)
}

export default McpView
