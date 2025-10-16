import { ModelInfo } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

// Aihubmix 支持的模型列表
const AIHUBMIX_MODELS = {
	"gpt-4o-mini": {
		name: "GPT-4o Mini",
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: true,
		supportsPromptCache: false,
		description: "Fast and efficient model for most tasks",
	},
	"gpt-4o": {
		name: "GPT-4o",
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: true,
		supportsPromptCache: false,
		description: "Most capable GPT-4 model",
	},
	"gpt-4-turbo": {
		name: "GPT-4 Turbo",
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: true,
		supportsPromptCache: false,
		description: "Advanced reasoning and analysis",
	},
	"claude-3-5-sonnet-20241022": {
		name: "Claude 3.5 Sonnet",
		maxTokens: 8192,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: true,
		description: "Anthropic's most capable model",
	},
	"claude-3-5-haiku-20241022": {
		name: "Claude 3.5 Haiku",
		maxTokens: 8192,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: true,
		description: "Fast and efficient Claude model",
	},
	"claude-3-opus-20240229": {
		name: "Claude 3 Opus",
		maxTokens: 8192,
		contextWindow: 200000,
		supportsImages: true,
		supportsPromptCache: true,
		description: "Most powerful Claude model",
	},
	"gemini-2.0-flash-exp": {
		name: "Gemini 2.0 Flash",
		maxTokens: 8192,
		contextWindow: 1000000,
		supportsImages: true,
		supportsPromptCache: false,
		description: "Google's latest multimodal model",
	},
	"gemini-1.5-pro": {
		name: "Gemini 1.5 Pro",
		maxTokens: 8192,
		contextWindow: 2000000,
		supportsImages: true,
		supportsPromptCache: false,
		description: "Google's advanced reasoning model",
	},
}

/**
 * Props for the AihubmixProvider component
 */
interface AihubmixProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Aihubmix provider configuration component
 */
export const AihubmixProvider = ({ showModelOptions, isPopup, currentMode }: AihubmixProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const [models, setModels] = useState<Record<string, ModelInfo>>({})

	// Get the normalized configuration

	// Fetch Aihubmix models from API
	useEffect(() => {
		ModelsServiceClient.getAihubmixModels(EmptyRequest.create({}))
			.then((response) => {
				if (response.models) {
					setModels(response.models as Record<string, ModelInfo>)
				}
			})
			.catch((error) => {
				console.error("Failed to fetch Aihubmix models:", error)
				// Fallback to static models if API fails
				setModels(Object.fromEntries(Object.entries(AIHUBMIX_MODELS).map(([id, info]) => [id, info as ModelInfo])))
			})
	}, [])

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.aihubmixApiKey || ""}
				onChange={(value) => handleFieldChange("aihubmixApiKey", value)}
				providerName="Aihubmix"
				signupUrl="https://console.aihubmix.com/token"
			/>

			{/* 折扣信息 */}
			{apiConfiguration?.aihubmixApiKey && (
				<div
					style={{
						backgroundColor: "var(--vscode-badge-background)",
						border: "1px solid var(--vscode-badge-foreground)",
						borderRadius: "4px",
						padding: "8px",
						marginTop: "10px",
					}}>
					<VSCodeLink
						href="https://aihubmix.com"
						style={{
							fontSize: "12px",
							color: "var(--vscode-foreground)",
							textDecoration: "none",
							fontWeight: 500,
						}}
						title="访问 Aihubmix 查看余额和使用情况">
						🎉 享受 Aihubmix 统一网关折扣优惠
					</VSCodeLink>
					<p
						style={{
							fontSize: "11px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						Aihubmix 提供统一的 AI 模型访问，支持 Claude、GPT、Gemini 等多种模型，享受折扣价格
					</p>
				</div>
			)}

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={models}
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
