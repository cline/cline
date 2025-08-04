import { EmptyRequest } from "@shared/proto/cline/common"
import { useState, useCallback, useEffect, useMemo } from "react"
import { useInterval } from "react-use"
import { ModelInfo } from "@shared/api"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ModelSelector } from "./common/ModelSelector"
import { DebouncedTextField } from "./common/DebouncedTextField"
import { ModelInfoView } from "./common/ModelInfoView"
import { getModeSpecificFields, normalizeApiConfiguration } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"
import { Mode } from "@shared/storage/types"

/**
 * Props for the VercelAIGatewayModelPicker component
 */
export interface VercelAIGatewayModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
}

/**
 * Model picker component for Vercel AI Gateway
 */
const VercelAIGatewayModelPicker: React.FC<VercelAIGatewayModelPickerProps> = ({ isPopup, currentMode }) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)

	const [vercelAiGatewayModels, setVercelAiGatewayModels] = useState<Record<string, ModelInfo>>({})
	const [isLoadingModels, setIsLoadingModels] = useState(true)

	const requestVercelAiGatewayModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.refreshVercelAiGatewayModels(EmptyRequest.create({}))
			if (response && response.models) {
				setVercelAiGatewayModels(response.models)
			}
			setIsLoadingModels(false)
		} catch (error) {
			console.error("Failed to fetch Vercel AI Gateway models:", error)
			setVercelAiGatewayModels({})
			setIsLoadingModels(false)
		}
	}, [])

	useEffect(() => {
		requestVercelAiGatewayModels()
	}, [requestVercelAiGatewayModels])

	useInterval(requestVercelAiGatewayModels, 2000)

	const hasModels = Object.keys(vercelAiGatewayModels).length > 0

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		const normalized = normalizeApiConfiguration(apiConfiguration, currentMode)

		// If we have models loaded and the selected model exists in our models,
		// use the fetched model info instead of what's stored in config
		if (hasModels && normalized.selectedModelId && vercelAiGatewayModels[normalized.selectedModelId]) {
			return {
				...normalized,
				selectedModelInfo: vercelAiGatewayModels[normalized.selectedModelId],
			}
		}

		return normalized
	}, [apiConfiguration, currentMode, vercelAiGatewayModels, hasModels])

	const handleModelChange = (modelId: string) => {
		const modelInfo = vercelAiGatewayModels[modelId]

		if (modelId && modelInfo) {
			handleModeFieldsChange(
				{
					vercelAiGatewayModelId: { plan: "planModeVercelAiGatewayModelId", act: "actModeVercelAiGatewayModelId" },
					vercelAiGatewayModelInfo: { plan: "planModeVercelAiGatewayModelInfo", act: "actModeVercelAiGatewayModelInfo" },
				},
				{
					vercelAiGatewayModelId: modelId,
					vercelAiGatewayModelInfo: modelInfo,
				},
				currentMode,
			)
		} else {
			handleModeFieldsChange(
				{
					vercelAiGatewayModelId: { plan: "planModeVercelAiGatewayModelId", act: "actModeVercelAiGatewayModelId" },
					vercelAiGatewayModelInfo: { plan: "planModeVercelAiGatewayModelInfo", act: "actModeVercelAiGatewayModelInfo" },
				},
				{
					vercelAiGatewayModelId: modelId,
					vercelAiGatewayModelInfo: undefined,
				},
				currentMode,
			)
		}
	}

	const getCurrentModelId = () => {
		return currentMode === "plan"
			? apiConfiguration?.planModeVercelAiGatewayModelId
			: apiConfiguration?.actModeVercelAiGatewayModelId
	}

	return (
		<>
			{hasModels ? (
				<ModelSelector
					models={vercelAiGatewayModels}
					selectedModelId={getCurrentModelId() || ""}
					onChange={(e) => handleModelChange(e.target.value)}
					label="Model"
				/>
			) : (
				<>
					<DebouncedTextField
						initialValue={getCurrentModelId() || ""}
						onChange={(value) =>
							handleModeFieldsChange(
								{
									vercelAiGatewayModelId: { plan: "planModeVercelAiGatewayModelId", act: "actModeVercelAiGatewayModelId" },
									vercelAiGatewayModelInfo: { plan: "planModeVercelAiGatewayModelInfo", act: "actModeVercelAiGatewayModelInfo" },
								},
								{
									vercelAiGatewayModelId: value,
									vercelAiGatewayModelInfo: undefined,
								},
								currentMode,
							)
						}
						style={{ width: "100%", marginBottom: 10 }}
						placeholder={"Enter Model ID (e.g., openai/gpt-4o)..."}>
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</DebouncedTextField>

					{!isLoadingModels && (
						<p
							style={{
								fontSize: "12px",
								marginTop: "-5px",
								marginBottom: "10px",
								color: "var(--vscode-descriptionForeground)",
								fontStyle: "italic",
							}}>
							Unable to fetch models from Vercel AI Gateway.
						</p>
					)}
				</>
			)}

			<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
		</>
	)
}

export default VercelAIGatewayModelPicker
