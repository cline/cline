import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the QwenProvider component
 */
interface QwenProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Alibaba Qwen provider configuration component
 */
export const QwenProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: QwenProviderProps) => {
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
				value={config?.qwenApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleTypedField("qwenApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>

			<VSCodeTextField
				value={config?.qwenBaseUrl || ""}
				style={{ width: "100%", marginTop: 10 }}
				type="url"
				onInput={handleTypedField("qwenBaseUrl")}
				placeholder="Enter Base URL (optional)">
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Alibaba Qwen (Tongyi Qianwen) is a large language model series from Alibaba Cloud. This key is stored locally and
				only used to make API requests from this extension.
			</p>

			{showModelOptions && (
				<>
					<VSCodeRadioGroup
						style={{ marginTop: 10 }}
						value={config?.qwenModelId || "qwen-max"}
						onChange={(e) => {
							const value = (e.target as HTMLInputElement)?.value
							if (value) {
								handleTypedField("qwenModelId")({ target: { value } })
							}
						}}>
						<VSCodeRadio value="qwen-max">Qwen Max</VSCodeRadio>
						<VSCodeRadio value="qwen-plus">Qwen Plus</VSCodeRadio>
						<VSCodeRadio value="qwen-turbo">Qwen Turbo</VSCodeRadio>
						<VSCodeRadio value="qwen-vl-max">Qwen VL Max</VSCodeRadio>
						<VSCodeRadio value="qwen-vl-plus">Qwen VL Plus</VSCodeRadio>
					</VSCodeRadioGroup>

					<ModelInfoView
						selectedModelId={selectedModelId || config?.qwenModelId || "qwen-max"}
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
