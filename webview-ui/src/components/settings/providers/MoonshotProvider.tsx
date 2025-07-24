import { moonshotModels } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useState } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Mode } from "@shared/ChatSettings"

/**
 * Props for the MoonshotProvider component
 */
interface MoonshotProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Moonshot AI Studio provider configuration component
 */
export const MoonshotProvider = ({ showModelOptions, isPopup, currentMode }: MoonshotProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Local state for Chinese API endpoint checkbox
	const [isChineseEndpoint, setIsChineseEndpoint] = useState(!!apiConfiguration?.moonshotApiLine)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const handleChineseEndpointToggle = (e: any) => {
		const checked = e.target.checked === true
		setIsChineseEndpoint(checked)
		handleFieldChange("moonshotApiLine", checked ? "china" : "")
	}

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.moonshotApiKey || ""}
				onChange={(value) => handleFieldChange("moonshotApiKey", value)}
				providerName="Moonshot"
				signupUrl="https://platform.moonshot.ai/console/api-keys"
				helpText="This key is stored locally and only used to make API requests from this extension."
			/>

			<VSCodeCheckbox
				checked={isChineseEndpoint}
				onChange={handleChineseEndpointToggle}
				style={{ marginTop: -3, marginBottom: 10 }}>
				Use Chinese API endpoint
			</VSCodeCheckbox>

			{showModelOptions && (
				<>
					<ModelSelector
						models={moonshotModels}
						selectedModelId={selectedModelId}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						label="Model"
					/>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
