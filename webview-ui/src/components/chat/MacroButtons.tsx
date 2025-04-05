import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { MacroButton as MacroButtonType } from "../../../../src/shared/ExtensionMessage"
import { vscode } from "../../utils/vscode"

interface MacroButtonsProps {
	macroButtons?: MacroButtonType[]
	isInputDisabled: boolean
}

const MacroButtons = ({ macroButtons, isInputDisabled }: MacroButtonsProps) => {
	if (!macroButtons || macroButtons.length === 0) {
		return null
	}

	const handleMacroClick = (action: string) => {
		vscode.postMessage({
			type: "invoke",
			invoke: "sendMessage",
			text: action,
		})
	}

	const openMacroManager = () => {
		vscode.postMessage({
			type: "action",
			action: "manageMacrosClicked",
		})
	}

	return (
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: "8px",
				marginBottom: "8px",
				padding: "0 8px",
				maxWidth: "100%",
				overflow: "hidden",
			}}>
			{macroButtons.map((macro) => (
				<VSCodeButton
					key={macro.id}
					appearance="secondary"
					disabled={isInputDisabled}
					title={macro.action}
					onClick={() => handleMacroClick(macro.action)}
					style={{
						maxWidth: "150px",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}>
					{macro.label}
				</VSCodeButton>
			))}
			<VSCodeButton appearance="secondary" disabled={isInputDisabled} title="Manage Macros" onClick={openMacroManager}>
				Manage
			</VSCodeButton>
		</div>
	)
}

export default MacroButtons
