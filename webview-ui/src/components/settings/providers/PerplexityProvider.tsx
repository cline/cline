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
 * Perplexity Sonar models include built-in web search grounding via the
 * OpenAI-compatible /v1/chat/completions endpoint at https://api.perplexity.ai.
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
				Sonar models perform built-in web search and return answers grounded in current sources. Get a key at{" "}
				<a href="https://www.perplexity.ai/account/api/keys" rel="noreferrer" target="_blank">
					perplexity.ai/account/api/keys
				</a>
				. See{" "}
				<a href="https://docs.perplexity.ai/docs/getting-started" rel="noreferrer" target="_blank">
					docs.perplexity.ai
				</a>{" "}
				for details.
			</p>
		</div>
	)
}
