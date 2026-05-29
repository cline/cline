import { ModelInfo, rodiumaiModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useCallback } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface RodiumaiProviderProps {
	currentMode: Mode
	isPopup?: boolean
	showModelOptions: boolean
}

export const RodiumaiProvider = ({ currentMode, isPopup, showModelOptions }: RodiumaiProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const handleModelChange = useCallback(
		(newModelId: string) => {
			if (!newModelId) {
				return
			}
			const modelInfo = rodiumaiModels[newModelId as keyof typeof rodiumaiModels] as ModelInfo | undefined
			handleModeFieldsChange(
				{
					rodiumaiModelId: { plan: "planModeRodiumaiModelId", act: "actModeRodiumaiModelId" },
					rodiumaiModelInfo: { plan: "planModeRodiumaiModelInfo", act: "actModeRodiumaiModelInfo" },
				},
				{
					rodiumaiModelId: newModelId,
					rodiumaiModelInfo: modelInfo,
				},
				currentMode,
			)
		},
		[handleModeFieldsChange, currentMode],
	)

	return (
		<div style={{ display: "flex", flexDirection: "column" }}>
			<ApiKeyField
				initialValue={apiConfiguration?.rodiumaiApiKey || ""}
				onChange={(value) => handleFieldChange("rodiumaiApiKey", value)}
				providerName="RodiumAI"
				signupUrl="https://www.rodiumai.io/"
			/>
			{showModelOptions && (
				<>
					<ModelSelector
						key={`rodiumai-${selectedModelId ?? "default"}`}
						label="Model"
						models={rodiumaiModels}
						onChange={(e: any) => handleModelChange(e.target.value)}
						selectedModelId={selectedModelId}
					/>
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
