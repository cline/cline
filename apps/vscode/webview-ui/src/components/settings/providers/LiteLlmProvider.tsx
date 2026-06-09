import { ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { RefreshCwIcon } from "lucide-react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelAutocomplete } from "../common/ModelAutocomplete"
import { ModelInfoView } from "../common/ModelInfoView"
import { LockIcon, RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"

const LITELLM_PROVIDER_ID = "litellm"
const SAVED_API_KEY_MASK_CHARACTER = "•"

function maskedKey(apiKeyLength: number | undefined): string {
	return SAVED_API_KEY_MASK_CHARACTER.repeat(Math.max(0, apiKeyLength ?? 0))
}

function sanitizeApiKeyInput(value: string, savedMask: string): string | undefined {
	if (!savedMask || !value.includes(SAVED_API_KEY_MASK_CHARACTER)) {
		return value
	}

	if (value === savedMask) {
		return undefined
	}

	return value.split(SAVED_API_KEY_MASK_CHARACTER).join("")
}

function customModelInfo(modelId: string): ModelInfo {
	return {
		...openAiModelInfoSafeDefaults,
		name: modelId,
	}
}

/**
 * Props for the LiteLlmProvider component
 */
interface LiteLlmProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const LiteLlmProvider = ({ showModelOptions, isPopup, currentMode }: LiteLlmProviderProps) => {
	const { remoteConfigSettings } = useExtensionState()
	const { models, defaultModelId, isLoading, isStale, error, refresh } = useProviderModels(LITELLM_PROVIDER_ID)
	const { config, write, commitSelection } = useProviderConfig(LITELLM_PROVIDER_ID)
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const selectedModelId = committedSelection?.modelId ?? defaultModelId ?? Object.keys(models)[0] ?? ""
	const selectedModelInfo = committedSelection?.modelInfo
		? fromProtobufModelInfo(committedSelection.modelInfo)
		: (models[selectedModelId] ?? (selectedModelId ? customModelInfo(selectedModelId) : openAiModelInfoSafeDefaults))
	const savedApiKeyMask = maskedKey(config?.apiKeyLength)

	const handleModelChange = (newModelId: string, modelInfo: ModelInfo | undefined) => {
		void commitSelection(currentMode, {
			providerId: LITELLM_PROVIDER_ID,
			modelId: newModelId,
			modelInfo: modelInfo ?? customModelInfo(newModelId),
		}).catch((err) => console.error("Failed to commit LiteLLM model selection:", err))
	}

	const onRefreshModels = async () => {
		await refresh()
	}

	const handleBaseUrlChange = (value: string) => {
		if (!config) {
			return
		}

		void write({ baseUrl: value }).catch((err) => console.error("Failed to update LiteLLM base URL:", err))
	}

	const handleApiKeyChange = (value: string) => {
		if (!config) {
			return
		}

		const apiKey = sanitizeApiKeyInput(value, savedApiKeyMask)

		if (apiKey === undefined) {
			return
		}

		void write({ apiKey }).catch((err) => console.error("Failed to update LiteLLM API key:", err))
	}

	return (
		<div>
			<RemotelyConfiguredInputWrapper hidden={remoteConfigSettings?.liteLlmBaseUrl === undefined}>
				<DebouncedTextField
					disabled={remoteConfigSettings?.liteLlmBaseUrl !== undefined}
					initialValue={config?.baseUrl || ""}
					onChange={handleBaseUrlChange}
					placeholder={"Default: http://localhost:4000"}
					style={{ width: "100%" }}
					type="text">
					<div className="flex items-center gap-2 mb-1">
						<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
						{remoteConfigSettings?.liteLlmBaseUrl !== undefined && <LockIcon />}
					</div>
				</DebouncedTextField>
			</RemotelyConfiguredInputWrapper>
			<RemotelyConfiguredInputWrapper hidden={!remoteConfigSettings?.configuredApiKeys?.litellm}>
				<DebouncedTextField
					disabled={remoteConfigSettings?.configuredApiKeys?.litellm}
					initialValue={savedApiKeyMask}
					onChange={handleApiKeyChange}
					placeholder="Default: noop"
					style={{ width: "100%" }}
					type="password">
					<div className="flex items-center gap-2 mb-1">
						<span style={{ fontWeight: 500 }}>API Key</span>
						{remoteConfigSettings?.configuredApiKeys?.litellm && <LockIcon />}
					</div>
				</DebouncedTextField>
			</RemotelyConfiguredInputWrapper>
			{showModelOptions && (
				<>
					{isStale && <div role="status">Model list may be stale for the current LiteLLM configuration.</div>}
					{error && <div role="alert">{error}</div>}
					<ModelAutocomplete
						label="Model"
						models={models}
						onChange={handleModelChange}
						placeholder="Search or enter a custom model ID..."
						selectedModelId={selectedModelId}
					/>
					<VSCodeButton
						className={`my-2 ${isLoading ? "animate-pulse" : ""}`}
						disabled={isLoading}
						onClick={onRefreshModels}>
						{isLoading ? (
							"Loading..."
						) : (
							<>
								Refresh models <RefreshCwIcon className="ml-1" />
							</>
						)}
					</VSCodeButton>

					{selectedModelInfo?.supportsReasoning && <ThinkingBudgetSlider currentMode={currentMode} />}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Extended thinking is available for models such as Sonnet-4, o3-mini, Deepseek R1, etc. More info on{" "}
				<VSCodeLink
					href="https://docs.litellm.ai/docs/reasoning_content"
					style={{ display: "inline", fontSize: "inherit" }}>
					thinking mode configuration
				</VSCodeLink>
			</p>

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				LiteLLM provides a unified interface to access various LLM providers' models. See their{" "}
				<VSCodeLink href="https://docs.litellm.ai/docs/" style={{ display: "inline", fontSize: "inherit" }}>
					quickstart guide
				</VSCodeLink>{" "}
				for more information.
			</p>
		</div>
	)
}
