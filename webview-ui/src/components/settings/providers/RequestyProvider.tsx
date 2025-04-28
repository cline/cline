import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the RequestyProvider component
 */
interface RequestyProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Requesty provider configuration component
 */
export const RequestyProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: RequestyProviderProps) => {
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
				value={config?.requestyApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleTypedField("requestyApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>

			<VSCodeTextField
				value={config?.requestyBaseUrl || ""}
				style={{ width: "100%", marginTop: 10 }}
				type="url"
				onInput={handleTypedField("requestyBaseUrl")}
				placeholder="https://api.requesty.dev">
				<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
			</VSCodeTextField>

			<VSCodeTextField
				value={config?.requestyApplicationId || ""}
				style={{ width: "100%", marginTop: 10 }}
				onInput={handleTypedField("requestyApplicationId")}
				placeholder="Your Application ID">
				<span style={{ fontWeight: 500 }}>Application ID</span>
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Requesty allows you to create custom LLM applications with structured outputs. This key is stored locally and only
				used to make API requests from this extension.
			</p>

			{showModelOptions && (
				<ModelInfoView
					selectedModelId={selectedModelId || "requesty-default"}
					modelInfo={selectedModelInfo}
					isPopup={isPopup}
				/>
			)}
		</div>
	)
}
