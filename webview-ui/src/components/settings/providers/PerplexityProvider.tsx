import { perplexityModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface PerplexityProviderProps {
	currentMode: Mode
	isPopup?: boolean
	showModelOptions: boolean
}

/**
 * Perplexity provider configuration component.
 *
 * Routes through Perplexity's Agent API (https://api.perplexity.ai/v1), which
 * exposes a multi-provider catalogue of frontier models — OpenAI GPT-5.x,
 * Anthropic Claude, Google Gemini, xAI Grok, NVIDIA Nemotron, and Perplexity's
 * own Sonar search model — all behind a single API key. Mirrors the
 * OpenRouter-style "pick your underlying model" UX.
 */
export const PerplexityProvider = ({ currentMode, isPopup, showModelOptions }: PerplexityProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange, handleFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.perplexityApiKey || ""}
				onChange={(value) => handleFieldChange("perplexityApiKey", value)}
				providerName="Perplexity"
				signupUrl="https://www.perplexity.ai/account/api/keys"
			/>
			<ModelSelector
				label="Model"
				models={perplexityModels}
				onChange={(e: any) => {
					handleModeFieldChange(
						{
							plan: "planModePerplexityModelId",
							act: "actModePerplexityModelId",
						},
						e.target.value,
						currentMode,
					)
				}}
				selectedModelId={selectedModelId}
			/>

			<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			<p
				style={{
					fontSize: "12px",
					marginTop: 6,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Perplexity's Agent API routes a single API key to frontier models from OpenAI, Anthropic, Google, xAI, NVIDIA, and
				Perplexity. Pick the underlying model above. Get a key at{" "}
				<a href="https://www.perplexity.ai/account/api/keys" rel="noreferrer" target="_blank">
					perplexity.ai/account/api/keys
				</a>
				. See{" "}
				<a href="https://docs.perplexity.ai/docs/agent-api/quickstart" rel="noreferrer" target="_blank">
					docs.perplexity.ai
				</a>{" "}
				for details.
			</p>
		</div>
	)
}
