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

// AIhubmix 支持的模型列表
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

	// 保证当前选中的模型在下拉列表中可见
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

	// 先回显旧数据/静态数据，再异步刷新并持久化到 localStorage
	useEffect(() => {
		try {
			const cached = window.localStorage.getItem("aihubmixModels")
			if (cached) {
				const parsed = JSON.parse(cached) as Record<string, ModelInfo>
				if (parsed && typeof parsed === "object") {
					setModels(ensureSelectedPresent(parsed))
				}
			} else {
				// 无缓存则使用静态回退，保证 UI 立即可用
				const fallback = Object.fromEntries(Object.entries(AIHUBMIX_MODELS).map(([id, info]) => [id, info as ModelInfo]))
				setModels(ensureSelectedPresent(fallback))
			}
		} catch {
			// 解析失败时使用静态回退
			const fallback = Object.fromEntries(Object.entries(AIHUBMIX_MODELS).map(([id, info]) => [id, info as ModelInfo]))
			setModels(ensureSelectedPresent(fallback))
		}

		// 异步刷新模型列表
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
				// 失败时保持当前 models，不打断用户
			})
	}, [])

	console.log("apiConfiguration", apiConfiguration)

	return (
		<div>
			<ApiKeyField
				helpText="Now request 10% discount！"
				initialValue={apiConfiguration?.aihubmixApiKey || ""}
				onChange={(value) => handleFieldChange("aihubmixApiKey", value)}
				providerName="AIhubmix"
				signupUrl="https://console.aihubmix.com/token" // 转英文
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={models}
						onChange={(e) => {
							const newModelId = e.target.value
							const newModelInfo = models[newModelId] as ModelInfo | undefined
							// 同步保存 ID 和 ModelInfo，避免切换后丢失
							if (newModelInfo) {
								handleModeFieldsChange(
									{
										id: { plan: "planModeAihubmixModelId", act: "actModeAihubmixModelId" },
										info: { plan: "planModeAihubmixModelInfo", act: "actModeAihubmixModelInfo" },
									},
									{ id: newModelId, info: newModelInfo },
									currentMode,
								)
								// 不同步写全局字段，保持 AIhubmix 与全局字段隔离
							} else {
								// 仅保存 ID（无信息时退化）
								handleModeFieldChange(
									{ plan: "planModeAihubmixModelId", act: "actModeAihubmixModelId" },
									newModelId,
									currentMode,
								)
								// 不同步写全局字段
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
