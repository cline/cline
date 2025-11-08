import { ModelInfo } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the AIhubmixProvider component
 */
interface AIhubmixProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The AIhubmix provider configuration component
 */
export const AIhubmixProvider = ({ showModelOptions, isPopup, currentMode }: AIhubmixProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const [models, setModels] = useState<Record<string, ModelInfo>>({})

	const ensureSelectedPresent = (base: Record<string, ModelInfo>): Record<string, ModelInfo> => {
		if (selectedModelId && !base[selectedModelId]) {
			const info = (selectedModelInfo as ModelInfo) || {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
			}
			return { ...base, [selectedModelId]: info }
		}
		return base
	}

	console.log("selectedModelId", selectedModelId)
	console.log("selectedModelInfo", selectedModelInfo)

	// Get the normalized configuration

	useEffect(() => {
		try {
			const cached = window.localStorage.getItem("aihubmixModels")
			if (cached) {
				const parsed = JSON.parse(cached) as Record<string, ModelInfo>
				if (parsed && typeof parsed === "object") {
					setModels(ensureSelectedPresent(parsed))
				}
			}
		} catch {
			setModels(ensureSelectedPresent({}))
		}

		ModelsServiceClient.getAihubmixModels(EmptyRequest.create({}))
			.then((response) => {
				if (response.models) {
					const nextModels = response.models as Record<string, ModelInfo>
					const injected = ensureSelectedPresent(nextModels)
					setModels(injected)
					try {
						window.localStorage.setItem("aihubmixModels", JSON.stringify(injected))
					} catch {}
				}
			})
			.catch((error) => {
				console.error("Failed to fetch AIhubmix models:", error)
			})
	}, [])

	console.log("apiConfiguration", apiConfiguration)

	return (
		<div>
			<ApiKeyField
				helpText="Now request 10% discount!"
				initialValue={apiConfiguration?.aihubmixApiKey || ""}
				onChange={(value) => handleFieldChange("aihubmixApiKey", value)}
				providerName="AIhubmix"
				signupUrl="https://console.aihubmix.com/token"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={models}
						onChange={(e) => {
							const newModelId = e.target.value
							const newModelInfo = models[newModelId] as ModelInfo | undefined
							if (newModelInfo) {
								handleModeFieldsChange(
									{
										id: { plan: "planModeAihubmixModelId", act: "actModeAihubmixModelId" },
										info: { plan: "planModeAihubmixModelInfo", act: "actModeAihubmixModelInfo" },
									},
									{ id: newModelId, info: newModelInfo },
									currentMode,
								)
							} else {
								handleModeFieldChange(
									{ plan: "planModeAihubmixModelId", act: "actModeAihubmixModelId" },
									newModelId,
									currentMode,
								)
							}
						}}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
