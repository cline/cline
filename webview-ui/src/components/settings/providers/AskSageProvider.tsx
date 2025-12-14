import { askSageDefaultURL, askSageModels, ModelInfo } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the AskSageProvider component
 */
interface AskSageProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The AskSage provider configuration component
 */
export const AskSageProvider = ({ showModelOptions, isPopup, currentMode }: AskSageProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const [availableModels, setAvailableModels] = useState<Record<string, ModelInfo>>(askSageModels)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	useEffect(() => {
		const fetchModels = async () => {
			try {
				const apiUrl = apiConfiguration?.asksageApiUrl || askSageDefaultURL
				const response = await fetch(`${apiUrl}/get-models`)

				if (!response.ok) {
					console.error("Failed to fetch AskSage models, falling back to default list.")
					setAvailableModels(askSageModels)
					return
				}

				const data = await response.json()
				const modelIds = data.response as string[]

				if (Array.isArray(modelIds) && modelIds.length > 0) {
					const filteredModels = Object.entries(askSageModels)
						.filter(([id]) => modelIds.includes(id))
						.reduce(
							(acc, [id, info]) => {
								acc[id] = info
								return acc
							},
							{} as Record<string, ModelInfo>,
						)
					setAvailableModels(Object.keys(filteredModels).length > 0 ? filteredModels : askSageModels)
				} else {
					setAvailableModels(askSageModels)
				}
			} catch (error) {
				console.error("Error fetching AskSage models:", error)
				setAvailableModels(askSageModels)
			}
		}

		fetchModels()
	}, [apiConfiguration?.asksageApiUrl])

	return (
		<div>
			<ApiKeyField
				helpText="This key is stored locally and only used to make API requests from this extension."
				initialValue={apiConfiguration?.asksageApiKey || ""}
				onChange={(value) => handleFieldChange("asksageApiKey", value)}
				providerName="AskSage"
			/>

			<DebouncedTextField
				initialValue={apiConfiguration?.asksageApiUrl || askSageDefaultURL}
				onChange={(value) => handleFieldChange("asksageApiUrl", value)}
				placeholder="Enter AskSage API URL..."
				style={{ width: "100%" }}
				type="text">
				<span style={{ fontWeight: 500 }}>AskSage API URL</span>
			</DebouncedTextField>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={availableModels}
						onChange={(e) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
