import { EmptyRequest } from "@shared/proto/common"
import { ModelsServiceClient } from "@/services/grpc-client"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState, useCallback, useEffect } from "react"
import { useInterval } from "react-use"
import * as vscodemodels from "vscode"
import { DropdownContainer, DROPDOWN_Z_INDEX } from "../ApiOptions"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

export const VSCodeLmProvider = () => {
	const [vsCodeLmModels, setVsCodeLmModels] = useState<vscodemodels.LanguageModelChatSelector[]>([])
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Poll VS Code LM models
	const requestVsCodeLmModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getVsCodeLmModels(EmptyRequest.create({}))
			if (response && response.models) {
				setVsCodeLmModels(response.models)
			}
		} catch (error) {
			console.error("Failed to fetch VS Code LM models:", error)
			setVsCodeLmModels([])
		}
	}, [])

	useEffect(() => {
		requestVsCodeLmModels()
	}, [requestVsCodeLmModels])

	useInterval(requestVsCodeLmModels, 2000)

	return (
		<div>
			<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 2} className="dropdown-container">
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

							handleFieldChange("vsCodeLmModelSelector", { vendor, family })
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
						from the VS Marketplace and enabling Claude 4 Sonnet.
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
