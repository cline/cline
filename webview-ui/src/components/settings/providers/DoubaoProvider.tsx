import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the DoubaoProvider component
 */
interface DoubaoProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The ByteDance Doubao provider configuration component
 */
export const DoubaoProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: DoubaoProviderProps) => {
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
				value={config?.doubaoApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleTypedField("doubaoApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>

			<VSCodeTextField
				value={config?.doubaoBaseUrl || ""}
				style={{ width: "100%", marginTop: 10 }}
				type="url"
				onInput={handleTypedField("doubaoBaseUrl")}
				placeholder="https://api.doubao.com/v1">
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				ByteDance Doubao (豆包) is a large language model series from ByteDance, the company behind TikTok. This key is
				stored locally and only used to make API requests from this extension.
			</p>

			{showModelOptions && (
				<>
					<VSCodeRadioGroup
						style={{ marginTop: 10 }}
						value={config?.doubaoModelId || "Doubao-lite"}
						onChange={(e) => {
							const value = (e.target as HTMLInputElement)?.value
							if (value) {
								handleTypedField("doubaoModelId")({ target: { value } })
							}
						}}>
						<VSCodeRadio value="Doubao-lite">Doubao Lite</VSCodeRadio>
						<VSCodeRadio value="Doubao-pro">Doubao Pro</VSCodeRadio>
					</VSCodeRadioGroup>

					<ModelInfoView
						selectedModelId={selectedModelId || config?.doubaoModelId || "Doubao-lite"}
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
