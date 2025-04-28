import { ApiConfiguration } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the LMStudioProvider component
 */
interface LMStudioProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The LM Studio provider configuration component
 */
export const LMStudioProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: LMStudioProviderProps) => {
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
				value={config?.lmStudioBaseUrl || "http://localhost:1234/v1"}
				style={{ width: "100%" }}
				type="url"
				onInput={handleTypedField("lmStudioBaseUrl")}
				placeholder="http://localhost:1234/v1">
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				LM Studio allows you to run various models locally on your computer. To use LM Studio with Cline, enable the HTTP
				server in LM Studio's interface, and make sure an inference session is active.
			</p>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-errorForeground)",
				}}>
				<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude models. Less
				capable models may not work as expected.
			</p>

			{showModelOptions && (
				<>
					<VSCodeTextField
						value={config?.lmStudioModelId || ""}
						style={{ width: "100%", marginTop: 10 }}
						onInput={handleTypedField("lmStudioModelId")}
						placeholder="Local model name (optional)">
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</VSCodeTextField>

					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						The model ID is optional and is used for display purposes only. LM Studio will use whichever model is
						currently loaded in the active inference session.
					</p>

					<ModelInfoView
						selectedModelId={selectedModelId || config?.lmStudioModelId || "local-model"}
						modelInfo={selectedModelInfo}
						isPopup={isPopup}
					/>
				</>
			)}
		</div>
	)
}
