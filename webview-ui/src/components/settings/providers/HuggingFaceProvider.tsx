import { Mode } from "@shared/storage/types"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { HuggingFaceModelPicker } from "../HuggingFaceModelPicker"

/**
 * Props for the HuggingFaceProvider component
 */
interface HuggingFaceProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Hugging Face provider configuration component
 */
export const HuggingFaceProvider = ({ showModelOptions, isPopup, currentMode }: HuggingFaceProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.huggingFaceApiKey || ""}
				onChange={(value) => handleFieldChange("huggingFaceApiKey", value)}
				style={{ width: "100%" }}
				type="password"
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>Hugging Face API Key</span>
			</DebouncedTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension. We don’t show pricing here
				because it depends on your Hugging Face provider settings and isn’t consistently available via their API{" "}
				<a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer">
					Get your API key here
				</a>
			</p>

			{showModelOptions && (
				<>
					<HuggingFaceModelPicker isPopup={isPopup} currentMode={currentMode} />
				</>
			)}
		</div>
	)
}
