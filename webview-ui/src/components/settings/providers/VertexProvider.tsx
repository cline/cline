import { ApiConfiguration, vertexModels } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { VSCodeRadio, VSCodeRadioGroup } from "@vscode/webview-ui-toolkit/react"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useState } from "react"

/**
 * Props for the VertexProvider component
 */
interface VertexProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The GCP Vertex AI provider configuration component
 */
export const VertexProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: VertexProviderProps) => {
	// Cast to any to work around TypeScript property checks
	const config = apiConfiguration as any

	// State for credential type
	const [useJson, setUseJson] = useState<boolean>(!!config?.vertexCredentialsJson)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Helper to safely handle field changes that aren't properly typed
	const handleFieldChange = (field: string) => (event: any) => {
		// Use type assertion to bypass TypeScript checking
		handleInputChange(field as any)(event)
	}

	return (
		<div>
			<VSCodeRadioGroup
				value={useJson ? "json" : "projectId"}
				onChange={(e) => {
					const value = (e.target as HTMLInputElement)?.value
					setUseJson(value === "json")
				}}>
				<VSCodeRadio value="projectId">Project ID-based authentication</VSCodeRadio>
				<VSCodeRadio value="json">JSON key file authentication</VSCodeRadio>
			</VSCodeRadioGroup>

			{useJson ? (
				<div>
					<label style={{ fontWeight: 500 }}>Service Account JSON</label>
					<VSCodeTextField
						value={config?.vertexCredentialsJson || ""}
						style={{ width: "100%" }}
						onInput={handleFieldChange("vertexCredentialsJson")}
						placeholder="Paste service account JSON credentials here"></VSCodeTextField>
					<p style={{ fontSize: "12px", margin: "3px 0" }}>Paste the entire contents of the JSON key file here</p>
				</div>
			) : (
				<>
					<VSCodeTextField
						value={config?.vertexProjectId || ""}
						style={{ width: "100%" }}
						onInput={handleFieldChange("vertexProjectId")}
						placeholder="Enter GCP Project ID...">
						<span style={{ fontWeight: 500 }}>GCP Project ID</span>
					</VSCodeTextField>

					<VSCodeTextField
						value={config?.vertexLocation || ""}
						style={{ width: "100%" }}
						onInput={handleFieldChange("vertexLocation")}
						placeholder="us-central1">
						<span style={{ fontWeight: 500 }}>GCP Region</span>
					</VSCodeTextField>
				</>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Provide either service account JSON credentials or your GCP Project ID. For Project ID-based authentication,
				you'll need to have the Google Cloud CLI installed and authorized.
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						models={vertexModels}
						selectedModelId={selectedModelId}
						onChange={handleInputChange("apiModelId")}
						label="Model"
					/>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
