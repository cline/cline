import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { AccountServiceClient } from "@/services/grpc-client"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { supportsReasoningEffortForModelId } from "../utils/providerUtils"

const OPENAI_CODEX_PROVIDER_ID = "openai-codex"

interface OpenAiCodexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * OpenAI Codex (ChatGPT Plus/Pro) provider configuration component.
 * Uses OAuth authentication instead of API keys.
 *
 * Model list, default model id, and the "hide per-token cost" UI hint all
 * come from the extension over gRPC (`ResolveProviderModels` /
 * `ListProviders`), which in turn sources them from the `@cline/llms` SDK.
 * The webview imports no static model data from `@shared/api` for this
 * provider, and the `hideUsageCost` flag is not hard-coded — it is
 * derived from the SDK's `ProviderInfo.metadata.usageCostDisplay`.
 */
export const OpenAiCodexProvider = ({ showModelOptions, isPopup, currentMode }: OpenAiCodexProviderProps) => {
	const { apiConfiguration, openAiCodexIsAuthenticated } = useExtensionState()
	const { config, commitSelection } = useProviderConfig(OPENAI_CODEX_PROVIDER_ID)
	const {
		models,
		selectedModelId: legacySelectedModelId,
		selectedModelInfo: legacySelectedModelInfo,
		hideUsageCost,
	} = useStaticProviderSelection(OPENAI_CODEX_PROVIDER_ID, apiConfiguration, currentMode)
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const selectedModelId = committedSelection?.modelId ?? legacySelectedModelId
	const selectedModelInfo = committedSelection?.modelInfo
		? fromProtobufModelInfo(committedSelection.modelInfo)
		: legacySelectedModelInfo

	const showReasoningEffort = supportsReasoningEffortForModelId(selectedModelId, true)

	const handleModelChange = (modelId: string) => {
		if (!modelId) {
			return
		}

		void commitSelection(currentMode, {
			providerId: OPENAI_CODEX_PROVIDER_ID,
			modelId,
		}).catch((err) => console.error("Failed to commit OpenAI Codex model selection:", err))
	}

	const handleSignIn = async () => {
		try {
			await AccountServiceClient.openAiCodexSignIn({})
		} catch (error) {
			console.error("Failed to sign in to OpenAI Codex:", error)
		}
	}

	const handleSignOut = async () => {
		try {
			await AccountServiceClient.openAiCodexSignOut({})
		} catch (error) {
			console.error("Failed to sign out of OpenAI Codex:", error)
		}
	}

	return (
		<div>
			<div style={{ marginBottom: "15px" }}>
				{openAiCodexIsAuthenticated ? (
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
						}}>
						<span style={{ color: "var(--vscode-descriptionForeground)" }}>Signed in to OpenAI Codex</span>
						<VSCodeButton appearance="secondary" onClick={handleSignOut}>
							Sign Out
						</VSCodeButton>
					</div>
				) : (
					<div>
						<p
							style={{
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								marginBottom: "10px",
							}}>
							Sign in with your ChatGPT Plus or Pro subscription to use GPT-5 models without an API key.
						</p>
						<VSCodeButton onClick={handleSignIn}>Sign in to OpenAI Codex</VSCodeButton>
					</div>
				)}
			</div>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={models}
						onChange={(event: Event) => handleModelChange((event.target as HTMLSelectElement | null)?.value ?? "")}
						selectedModelId={selectedModelId}
					/>
					{showReasoningEffort && <ReasoningEffortSelector currentMode={currentMode} />}

					<ModelInfoView
						hideUsageCost={hideUsageCost}
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						selectedModelId={selectedModelId}
					/>
				</>
			)}
		</div>
	)
}
