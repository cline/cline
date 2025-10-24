import { gatewayzModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface GatewayzProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const GatewayzProvider = ({ showModelOptions, isPopup, currentMode }: GatewayzProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const [gatewayzEndpointSelected, setGatewayzEndpointSelected] = useState(!!apiConfiguration?.gatewayzBaseUrl)

	const { selectedModelId } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const signupUrl = apiConfiguration?.gatewayzBaseUrl
		? new URL("api-keys", apiConfiguration.gatewayzBaseUrl).toString()
		: "https://gatewayz.io"

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.gatewayzApiKey || ""}
				onChange={(value) => handleFieldChange("gatewayzApiKey", value)}
				providerName="Gatewayz"
				signupUrl={signupUrl}
			/>
			<VSCodeCheckbox
				checked={gatewayzEndpointSelected}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					setGatewayzEndpointSelected(isChecked)
					if (!isChecked) {
						handleFieldChange("gatewayzBaseUrl", undefined)
					}
				}}>
				Use custom base URL
			</VSCodeCheckbox>
			{gatewayzEndpointSelected && (
				<DebouncedTextField
					initialValue={apiConfiguration?.gatewayzBaseUrl ?? ""}
					onChange={(value) => {
						if (value.length === 0) {
							handleFieldChange("gatewayzBaseUrl", undefined)
						} else {
							handleFieldChange("gatewayzBaseUrl", value)
						}
					}}
					placeholder="Custom base URL"
					style={{ width: "100%", marginBottom: 5 }}
					type="text"
				/>
			)}
			{showModelOptions && (
				<ModelSelector
					label="Model"
					models={gatewayzModels}
					onChange={(e: any) =>
						handleModeFieldChange(
							{ plan: "planModeGatewayzModelId", act: "actModeGatewayzModelId" },
							e.target.value,
							currentMode,
						)
					}
					selectedModelId={selectedModelId}
				/>
			)}
		</div>
	)
}
