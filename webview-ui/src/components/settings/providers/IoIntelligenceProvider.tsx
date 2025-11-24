import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the IoIntelligenceProvider component
 */
interface IoIntelligenceProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The IO Intelligence provider configuration component
 */
export const IoIntelligenceProvider = ({ showModelOptions, isPopup, currentMode }: IoIntelligenceProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.ioIntelligenceApiKey || ""}
				onChange={(value) => handleFieldChange("ioIntelligenceApiKey", value)}
				providerName="IO Intelligence"
				signupUrl="https://io.net/intelligence"
			/>

			<BaseUrlField
				initialValue={apiConfiguration?.ioIntelligenceBaseUrl}
				label="Base URL"
				onChange={(value) => handleFieldChange("ioIntelligenceBaseUrl", value)}
				placeholder="Default: https://api.intelligence.io.solutions/api/v1"
			/>

			<DebouncedTextField
				initialValue={selectedModelId || ""}
				onChange={(value) =>
					handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, value, currentMode)
				}
				placeholder="Enter Model ID (e.g., gpt-4o)"
				style={{ width: "100%", marginBottom: 10 }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
