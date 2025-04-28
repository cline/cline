import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the TogetherProvider component
 */
interface TogetherProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Together.ai provider configuration component
 */
export const TogetherProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: TogetherProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Use type assertion to handle properties not defined in the interface
	const config = apiConfiguration as any

	// Helper for handling field changes that aren't properly typed
	const handleTypedField = (field: string) => (event: any) => {
		// Use type assertion to bypass TypeScript constraints
		handleInputChange(field as any)(event)
	}

	return (
		<div>
			<VSCodeTextField
				value={config?.togetherApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleTypedField("togetherApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Together.ai provides access to a wide range of open-source and fine-tuned models. Get your API key at{" "}
				<a href="https://www.together.ai/" style={{ color: "inherit" }}>
					together.ai
				</a>
				. This key is stored locally and only used to make API requests from this extension.
			</p>

			{showModelOptions && (
				<>
					<VSCodeTextField
						value={config?.togetherModelId || ""}
						style={{ width: "100%", marginTop: 10 }}
						onInput={handleTypedField("togetherModelId")}
						placeholder="e.g. togethercomputer/llama-2-70b">
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>

					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						Specify the Together.ai model to use, e.g. 'togethercomputer/llama-2-70b'. See{" "}
						<a href="https://docs.together.ai/docs/inference-models" style={{ color: "inherit" }}>
							available models
						</a>
						.
					</p>

					<ModelInfoView
						selectedModelId={selectedModelId || config?.togetherModelId || "togethercomputer/llama-2-70b"}
						modelInfo={selectedModelInfo}
						isPopup={isPopup}
					/>
				</>
			)}
		</div>
	)
}
