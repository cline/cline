import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"
import { useEffect, useState } from "react"
import { vscode } from "@/utils/vscode"
import DropdownContainer from "../DropdownContainer"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../../OpenRouterModelPicker"

const VscodeLMOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()
	const [vsCodeLmModels, setVsCodeLmModels] = useState<any[]>([])

	// Request VS Code LM models when component mounts
	useEffect(() => {
		vscode.postMessage({ type: "requestVsCodeLmModels" })
	}, [])

	// Listen for VS Code LM models
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "vsCodeLmModels" && message.vsCodeLmModels) {
				setVsCodeLmModels(message.vsCodeLmModels)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	return (
		<div>
			<DropdownContainer zIndex={OPENROUTER_MODEL_PICKER_Z_INDEX - 2} className="dropdown-container">
				<label htmlFor="vscode-lm-model">
					<span style={{ fontWeight: 500 }}>Language Model</span>
				</label>
				{vsCodeLmModels.length > 0 ? (
					<VSCodeDropdown
						id="vscode-lm-model"
						value={
							apiConfiguration?.vsCodeLmModelSelector
								? `${apiConfiguration.vsCodeLmModelSelector.vendor ?? ""}/${apiConfiguration.vsCodeLmModelSelector.family ?? ""}`
								: ""
						}
						onChange={(e) => {
							const value = (e.target as HTMLInputElement).value
							if (!value) {
								return
							}
							const [vendor, family] = value.split("/")
							handleInputChange("vsCodeLmModelSelector")({
								target: {
									value: { vendor, family },
								},
							})
						}}
						style={{ width: "100%" }}>
						<VSCodeOption value="">Select a model...</VSCodeOption>
						{vsCodeLmModels.map((model) => (
							<VSCodeOption key={`${model.vendor}/${model.family}`} value={`${model.vendor}/${model.family}`}>
								{model.vendor} - {model.family}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				) : (
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						The VS Code Language Model API allows you to run models provided by other VS Code extensions (including
						but not limited to GitHub Copilot). The easiest way to get started is to install the Copilot extension
						from the VS Marketplace and enabling Claude 3.7 Sonnet.
					</p>
				)}

				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-errorForeground)",
						fontWeight: 500,
					}}>
					Note: This is a very experimental integration and may not work as expected.
				</p>
			</DropdownContainer>
		</div>
	)
}

export default VscodeLMOptions
