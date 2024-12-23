import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../../context/ExtensionStateContext"

type DebugViewProps = {
	onDone: () => void
}

const DebugView = ({ onDone }: DebugViewProps) => {
	const { } = useExtensionState()

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
			}}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "10px 17px 10px 20px",
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>Debug</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>

			<div style={{ flex: 1, overflow: "auto", padding: "0 20px" }}>
				<div
					style={{
						color: "var(--vscode-foreground)",
						fontSize: "13px",
						marginBottom: "20px",
						marginTop: "5px",
					}}>
					Debug tools and information for troubleshooting Cline.
				</div>

				{/* Debug content will go here */}
				<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
					{/* Add debug information and tools here */}
				</div>

				{/* Bottom padding */}
				<div style={{ height: "20px" }} />
			</div>
		</div>
	)
}

export default DebugView