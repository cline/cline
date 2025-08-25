import { EmptyRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { useCallback, useMemo, useState } from "react"
import { useMount } from "react-use"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

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
	const { apiConfiguration, vercelAiGatewayModels, setVercelAiGatewayModels } = useExtensionState()
	const { handleFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()
	const [isLoadingModels, setIsLoadingModels] = useState(false)

	// Get the normalized configuration (includes defaults)
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Fetch models only once when component mounts
	useMount(() => {
		if (showModelOptions) {
			setIsLoadingModels(true)
			ModelsServiceClient.refreshVercelAiGatewayModels(EmptyRequest.create({}))
				.then((response) => {
					if (response && response.models) {
						setVercelAiGatewayModels(response.models)
					}
					setIsLoadingModels(false)
				})
				.catch((error) => {
					console.error("Failed to fetch Vercel AI Gateway models:", error)
					setVercelAiGatewayModels({})
					setIsLoadingModels(false)
				})
		}
	})

	const handleModelChange = useCallback(
		(modelId: string) => {
			handleModeFieldsChange(
				{
					vercelAiGatewayModelId: { plan: "planModeVercelAiGatewayModelId", act: "actModeVercelAiGatewayModelId" },
					vercelAiGatewayModelInfo: {
						plan: "planModeVercelAiGatewayModelInfo",
						act: "actModeVercelAiGatewayModelInfo",
					},
				},
				{
					vercelAiGatewayModelId: modelId,
					vercelAiGatewayModelInfo: vercelAiGatewayModels[modelId],
				},
				currentMode,
			)
		},
		[vercelAiGatewayModels, handleModeFieldsChange, currentMode],
	)

	const hasModels = useMemo(() => {
		return Object.keys(vercelAiGatewayModels).length > 0
	}, [vercelAiGatewayModels])

	const displayModelInfo = useMemo(() => {
		if (hasModels && selectedModelId && vercelAiGatewayModels[selectedModelId]) {
			return vercelAiGatewayModels[selectedModelId]
		}
		return selectedModelInfo
	}, [hasModels, selectedModelId, vercelAiGatewayModels, selectedModelInfo])

	return (
		<div>
			<div>
				<DebouncedTextField
					initialValue={apiConfiguration?.vercelAiGatewayApiKey || ""}
					onChange={(value) => handleFieldChange("vercelAiGatewayApiKey", value)}
					placeholder="Enter API Key..."
					style={{ width: "100%" }}
					type="password">
					<span style={{ fontWeight: 500 }}>Vercel AI Gateway API Key</span>
				</DebouncedTextField>
				<p
					style={{
						fontSize: "12px",
						marginTop: 3,
						color: "var(--vscode-descriptionForeground)",
					}}>
					This key is stored locally and only used to make API requests from this extension.
					{!apiConfiguration?.vercelAiGatewayApiKey && (
						<span>
							{" "}
							<a
								href="https://vercel.com/"
								style={{
									color: "var(--vscode-textLink-foreground)",
									textDecoration: "none",
								}}>
								You can get a Vercel AI Gateway API key by signing up here.
							</a>
						</span>
					)}
				</p>
			</div>

			{showModelOptions && (
				<>
					{hasModels ? (
						<ModelSelector
							label="Model"
							models={vercelAiGatewayModels}
							onChange={(e) => handleModelChange(e.target.value)}
							selectedModelId={selectedModelId || ""}
						/>
					) : (
						<>
							<DebouncedTextField
								initialValue={selectedModelId || ""}
								onChange={(value) =>
									handleModeFieldsChange(
										{
											vercelAiGatewayModelId: {
												plan: "planModeVercelAiGatewayModelId",
												act: "actModeVercelAiGatewayModelId",
											},
											vercelAiGatewayModelInfo: {
												plan: "planModeVercelAiGatewayModelInfo",
												act: "actModeVercelAiGatewayModelInfo",
											},
										},
										{
											vercelAiGatewayModelId: value,
											vercelAiGatewayModelInfo: undefined,
										},
										currentMode,
									)
								}
								placeholder={"Enter Model ID (e.g., openai/gpt-4o)..."}
								style={{ width: "100%", marginBottom: 10 }}>
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

					{displayModelInfo && (
						<ModelInfoView isPopup={isPopup} modelInfo={displayModelInfo} selectedModelId={selectedModelId} />
					)}
				</>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: "15px",
					color: "var(--vscode-descriptionForeground)",
					fontStyle: "italic",
				}}>
				Note: Free tier users will see $0 costs as these requests are provided at no charge by Vercel AI Gateway.
			</p>
		</div>
	)
}
