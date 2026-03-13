import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getEnvironmentColor } from "@/utils/environmentColors"
import PromptsLibraryTab from "./PromptsLibraryTab"

type PromptsLibraryViewProps = {
	onDone: () => void
}

const PromptsLibraryView = ({ onDone }: PromptsLibraryViewProps) => {
	const { environment, promptsCatalog } = useExtensionState()

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
					padding: "10px 17px 5px 20px",
				}}>
				<h3
					style={{
						color: getEnvironmentColor(environment),
						margin: 0,
					}}>
					Prompts Library
				</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>

			<div style={{ flex: 1, overflow: "auto" }}>
				<PromptsLibraryTab catalog={promptsCatalog} />
			</div>
		</div>
	)
}

export default PromptsLibraryView
