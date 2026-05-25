import { ModelInfo } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import { fromProtobufModels } from "@shared/proto-conversions/models/typeConversion"
import { Mode } from "@shared/storage/types"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import AihubmixModelPicker from "../AihubmixModelPicker"
import { ApiKeyField } from "../common/ApiKeyField"
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
	const { handleFieldChange } = useApiConfigurationHandlers()
	const [models, setModels] = useState<Record<string, ModelInfo>>({})

	// Get current provider to detect when switching to aihubmix
	const currentProvider = currentMode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider

	// Fetch models whenever component mounts, provider switches to aihubmix, or model options are shown
	useEffect(() => {
		// Only fetch if model options are shown (to avoid unnecessary requests)
		if (!showModelOptions) {
			return
		}

		// First, load cached data from localStorage for immediate display
		try {
			const cached = window.localStorage.getItem("aihubmixModels")
			if (cached) {
				const parsed = JSON.parse(cached) as Record<string, ModelInfo>
				if (parsed && typeof parsed === "object") {
					setModels(parsed)
				}
			}
		} catch {
			// Ignore cache parsing errors
		}

		// Then, always fetch fresh models from API
		ModelsServiceClient.getAihubmixModels(EmptyRequest.create({}))
			.then((response) => {
				if (response.models) {
					// Convert protobuf models to application ModelInfo type
					const nextModels = fromProtobufModels(response.models)
					setModels(nextModels)
					// Update cache for next time
					try {
						window.localStorage.setItem("aihubmixModels", JSON.stringify(nextModels))
					} catch {
						// Ignore cache write errors
					}
				}
			})
			.catch((error) => {
				console.error("Failed to fetch AIhubmix models:", error)
				// If API request fails and we don't have cached data, keep empty state
				// (cached data was already loaded above if available)
			})
		// Re-fetch when provider switches to aihubmix or when model options are shown
	}, [currentProvider, showModelOptions])

	return (
		<div>
			<ApiKeyField
				helpText="Now request 10% discount!"
				initialValue={apiConfiguration?.aihubmixApiKey || ""}
				onChange={(value) => handleFieldChange("aihubmixApiKey", value)}
				providerName="AIhubmix"
				signupUrl="https://console.aihubmix.com/token"
			/>

			{showModelOptions && <AihubmixModelPicker currentMode={currentMode} isPopup={isPopup} models={models} />}
		</div>
	)
}
