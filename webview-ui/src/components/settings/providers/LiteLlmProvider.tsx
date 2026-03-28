import { ModelInfo } from "@shared/api"
import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelAutocomplete } from "../common/ModelAutocomplete"
import { ModelInfoView } from "../common/ModelInfoView"
import { LockIcon, RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the LiteLlmProvider component
 */
interface LiteLlmProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const LiteLlmProvider = ({ showModelOptions, isPopup, currentMode }: LiteLlmProviderProps) => {
	const { apiConfiguration, remoteConfigSettings, liteLlmModels, refreshLiteLlmModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()

	const [isLoading, setIsLoading] = useState(false)

	// Get the normalized configuration with model info
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const handleModelChange = (newModelId: string, modelInfo: ModelInfo | undefined) => {
		handleModeFieldsChange(
			{
				liteLlmModelId: { plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" },
				liteLlmModelInfo: { plan: "planModeLiteLlmModelInfo", act: "actModeLiteLlmModelInfo" },
			},
			{
				liteLlmModelId: newModelId,
				liteLlmModelInfo: modelInfo,
			},
			currentMode,
		)
	}

	const onRefreshModels = async () => {
		try {
			setIsLoading(true)
			await refreshLiteLlmModels()
		} finally {
			setIsLoading(false)
		}
	}

	return (
		<div>
			<RemotelyConfiguredInputWrapper hidden={remoteConfigSettings?.liteLlmBaseUrl === undefined}>
				<DebouncedTextField
					disabled={remoteConfigSettings?.liteLlmBaseUrl !== undefined}
					initialValue={apiConfiguration?.liteLlmBaseUrl || ""}
					onChange={async (value) => {
						await ModelsServiceClient.updateApiConfiguration(
							UpdateApiConfigurationRequestNew.create({
								updates: {
									options: {
										liteLlmBaseUrl: value,
									},
								},
								updateMask: ["options.liteLlmBaseUrl"],
							}),
						)
					}}
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
					initialValue={apiConfiguration?.liteLlmApiKey || ""}
					onChange={async (value) => {
						await ModelsServiceClient.updateApiConfiguration(
							UpdateApiConfigurationRequestNew.create({
								updates: {
									secrets: {
										liteLlmApiKey: value,
									},
								},
								updateMask: ["secrets.liteLlmApiKey"],
							}),
						)
					}}
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
					<ModelAutocomplete
						label="Model"
						models={liteLlmModels}
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
