import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the SambanovaProvider component
 */
interface SambanovaProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The SambaNova provider configuration component
 */
export const SambanovaProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: SambanovaProviderProps) => {
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
				value={config?.sambanovaApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleTypedField("sambanovaApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>

			<VSCodeTextField
				value={config?.sambanovaBaseUrl || ""}
				style={{ width: "100%", marginTop: 10 }}
				type="url"
				onInput={handleTypedField("sambanovaBaseUrl")}
				placeholder="https://api.sambanova.ai/chat/v1">
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				SambaNova provides enterprise-grade AI models optimized for performance. This key is stored locally and only used
				to make API requests from this extension.
			</p>

			{showModelOptions && (
				<>
					<VSCodeRadioGroup
						style={{ marginTop: 10 }}
						value={config?.sambanovaModelId || "sambastudio-codellama-34b"}
						onChange={(e) => {
							const value = (e.target as HTMLInputElement)?.value
							if (value) {
								handleTypedField("sambanovaModelId")({ target: { value } })
							}
						}}>
						<VSCodeRadio value="sambastudio-codellama-34b">SambaStudio CodeLlama 34B</VSCodeRadio>
						<VSCodeRadio value="sambastudio-llama-2-70b">SambaStudio Llama 2 70B</VSCodeRadio>
						<VSCodeRadio value="sambastudio-llama-2-7b">SambaStudio Llama 2 7B</VSCodeRadio>
					</VSCodeRadioGroup>

					<ModelInfoView
						selectedModelId={selectedModelId || config?.sambanovaModelId || "sambastudio-codellama-34b"}
						modelInfo={selectedModelInfo}
						isPopup={isPopup}
					/>
				</>
			)}
		</div>
	)
}

// Add missing imports
import { VSCodeRadioGroup, VSCodeRadio } from "@vscode/webview-ui-toolkit/react"
