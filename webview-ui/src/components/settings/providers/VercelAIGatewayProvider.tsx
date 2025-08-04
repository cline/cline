import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useInterval } from "react-use"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ModelInfo } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { Mode } from "@shared/storage/types"

/**
 * Props for the VercelAIGatewayProvider component
 */
interface VercelAIGatewayProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Vercel AI Gateway provider configuration component
 */
export const VercelAIGatewayProvider = ({ showModelOptions, isPopup, currentMode }: VercelAIGatewayProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()
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

	useEffect(() => {
		if (showModelOptions) {
			requestVercelAiGatewayModels()
		}
	}, [requestVercelAiGatewayModels, showModelOptions])

	// Only poll when model options are shown
	useInterval(showModelOptions ? requestVercelAiGatewayModels : () => { }, showModelOptions ? 2000 : null)

	const hasModels = useMemo(() => {
		return Object.keys(vercelAiGatewayModels).length > 0
	}, [vercelAiGatewayModels])

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		const normalized = normalizeApiConfiguration(apiConfiguration, currentMode)

		if (hasModels && normalized.selectedModelId && vercelAiGatewayModels[normalized.selectedModelId]) {
			return {
				...normalized,
				selectedModelInfo: vercelAiGatewayModels[normalized.selectedModelId],
			}
		}

		return normalized
	}, [apiConfiguration, vercelAiGatewayModels, hasModels])

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.vercelAiGatewayApiKey || ""}
				onChange={(value) => handleFieldChange("vercelAiGatewayApiKey", value)}
				providerName="Vercel AI Gateway"
				signupUrl="https://vercel.com/"
			/>

			{showModelOptions && (
				<>
					{hasModels ? (
						<ModelSelector
							models={vercelAiGatewayModels}
							selectedModelId={selectedModelId || ""}
							onChange={(e) => handleModelChange(e.target.value)}
							label="Model"
						/>
					) : (
						<>
							<DebouncedTextField
								initialValue={selectedModelId || ""}
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
			)}
		</div >
	)
}
