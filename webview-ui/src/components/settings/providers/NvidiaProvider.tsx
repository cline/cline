import { nvidiaDefaultModelId } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface NvidiaProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const NvidiaProvider = ({ showModelOptions, isPopup, currentMode }: NvidiaProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				helpText="This key is stored locally and only used to make API requests from this extension."
				initialValue={apiConfiguration?.nvidiaApiKey || ""}
				onChange={(value) => handleFieldChange("nvidiaApiKey", value)}
				providerName="NVIDIA NIM"
				signupUrl="https://build.nvidia.com/explore/discover"
			/>

			{showModelOptions && (
				<>
					<DebouncedTextField
						initialValue={selectedModelId || ""}
						onChange={(value) =>
							handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, value, currentMode)
						}
						placeholder={nvidiaDefaultModelId}
						style={{ width: "100%", marginBottom: 10 }}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</DebouncedTextField>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
