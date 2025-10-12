import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the AihubmixProvider component
 */
interface AihubmixProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

// Aihubmix 支持的模型列表
const aihubmixModels = {
	"gpt-4o-mini": { name: "GPT-4o Mini", maxTokens: 128000, supportsPromptCache: false },
	"gpt-4o": { name: "GPT-4o", maxTokens: 128000, supportsPromptCache: false },
	"gpt-4-turbo": { name: "GPT-4 Turbo", maxTokens: 128000, supportsPromptCache: false },
	"gpt-3.5-turbo": { name: "GPT-3.5 Turbo", maxTokens: 16384, supportsPromptCache: false },
	"claude-3-5-sonnet-20241022": { name: "Claude 3.5 Sonnet", maxTokens: 200000, supportsPromptCache: false },
	"claude-3-5-haiku-20241022": { name: "Claude 3.5 Haiku", maxTokens: 200000, supportsPromptCache: false },
	"claude-3-opus-20240229": { name: "Claude 3 Opus", maxTokens: 200000, supportsPromptCache: false },
}

/**
 * The Aihubmix provider configuration component
 */
export const AihubmixProvider = ({ showModelOptions, isPopup, currentMode }: AihubmixProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.aihubmixApiKey || ""}
				onChange={(value) => handleFieldChange("aihubmixApiKey", value)}
				providerName="Aihubmix"
				signupUrl="https://aihubmix.com"
			/>

			<BaseUrlField
				initialValue={apiConfiguration?.aihubmixBaseUrl}
				label="Use custom base URL"
				onChange={(value) => handleFieldChange("aihubmixBaseUrl", value)}
				placeholder="Default: https://aihubmix.com"
			/>

			<div style={{ marginBottom: 10 }}>
				<label htmlFor="aihubmix-app-code">
					<span style={{ fontWeight: 500 }}>APP Code (for discounts)</span>
				</label>
				<input
					id="aihubmix-app-code"
					onChange={(e) => handleFieldChange("aihubmixAppCode", e.target.value)}
					placeholder="WHVL9885"
					style={{
						width: "100%",
						padding: "8px",
						border: "1px solid var(--vscode-input-border)",
						backgroundColor: "var(--vscode-input-background)",
						color: "var(--vscode-input-foreground)",
						borderRadius: "2px",
						fontSize: "13px",
					}}
					type="text"
					value={apiConfiguration?.aihubmixAppCode || "WHVL9885"}
				/>
				<p
					style={{
						fontSize: "12px",
						marginTop: 3,
						color: "var(--vscode-descriptionForeground)",
					}}>
					APP Code for discounts. Default: WHVL9885
				</p>
			</div>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={aihubmixModels}
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
