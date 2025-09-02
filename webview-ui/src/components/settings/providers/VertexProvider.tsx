import { vertexGlobalModels, vertexModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DROPDOWN_Z_INDEX, DropdownContainer } from "../ApiOptions"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the VertexProvider component
 */
interface VertexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

// Vertex models that support thinking
const SUPPORTED_THINKING_MODELS = [
	"claude-3-7-sonnet@20250219",
	"claude-sonnet-4@20250514",
	"claude-opus-4@20250514",
	"claude-opus-4-1@20250805",
	"gemini-2.5-flash",
	"gemini-2.5-pro",
	"gemini-2.5-flash-lite-preview-06-17",
]

/**
 * The GCP Vertex AI provider configuration component
 */
export const VertexProvider = ({ showModelOptions, isPopup, currentMode }: VertexProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Determine which models to use based on region
	const modelsToUse = apiConfiguration?.vertexRegion === "global" ? vertexGlobalModels : vertexModels

	const [vertexEndpointSelected, setVertexEndpointSelected] = useState(!!apiConfiguration?.vertexBaseUrl)

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 5,
			}}>
			<DebouncedTextField
				initialValue={apiConfiguration?.vertexProjectId || ""}
				onChange={(value) => handleFieldChange("vertexProjectId", value)}
				placeholder="Enter Project ID..."
				style={{ width: "100%" }}>
				<span style={{ fontWeight: 500 }}>Google Cloud Project ID</span>
			</DebouncedTextField>

			<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 1}>
				<label htmlFor="vertex-region-dropdown">
					<span style={{ fontWeight: 500 }}>Google Cloud Region</span>
				</label>
				<VSCodeDropdown
					id="vertex-region-dropdown"
					onChange={(e: any) => handleFieldChange("vertexRegion", e.target.value)}
					style={{ width: "100%" }}
					value={apiConfiguration?.vertexRegion || ""}>
					<VSCodeOption value="">Select a region...</VSCodeOption>
					<VSCodeOption value="us-east5">us-east5</VSCodeOption>
					<VSCodeOption value="us-central1">us-central1</VSCodeOption>
					<VSCodeOption value="europe-west1">europe-west1</VSCodeOption>
					<VSCodeOption value="europe-west4">europe-west4</VSCodeOption>
					<VSCodeOption value="asia-southeast1">asia-southeast1</VSCodeOption>
					<VSCodeOption value="global">global</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>

			<DebouncedTextField
				initialValue={apiConfiguration?.vertexApiKey || ""}
				onChange={(value) => handleFieldChange("vertexApiKey", value)}
				placeholder="Enter API key (optional)"
				style={{ width: "100%" }}
				type="password">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</DebouncedTextField>

			<p
				style={{
					fontSize: "11px",
					marginTop: "2px",
					marginBottom: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				If provided, this API key will be used for authentication instead of Application Default Credentials.
			</p>

			<div style={{ display: "flex", flexDirection: "column" }}>
				<VSCodeCheckbox
					checked={vertexEndpointSelected}
					onChange={(e: any) => {
						const isChecked = e.target.checked === true
						setVertexEndpointSelected(isChecked)
						if (!isChecked) {
							handleFieldChange("vertexBaseUrl", "")
						}
					}}>
					Use custom endpoint
				</VSCodeCheckbox>

				{vertexEndpointSelected && (
					<DebouncedTextField
						initialValue={apiConfiguration?.vertexBaseUrl || ""}
						onChange={(value) => handleFieldChange("vertexBaseUrl", value)}
						placeholder="Enter custom endpoint URL (e.g., proxy endpoint)"
						style={{ width: "100%", marginTop: 3, marginBottom: 5 }}
						type="url"
					/>
				)}
			</div>

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				To use Google Cloud Vertex AI, you need to
				<VSCodeLink
					href="https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin"
					style={{ display: "inline", fontSize: "inherit" }}>
					{"1) create a Google Cloud account › enable the Vertex AI API › enable the desired Claude models,"}
				</VSCodeLink>{" "}
				<VSCodeLink
					href="https://cloud.google.com/docs/authentication/provide-credentials-adc#google-idp"
					style={{ display: "inline", fontSize: "inherit" }}>
					{"2) install the Google Cloud CLI › configure Application Default Credentials."}
				</VSCodeLink>
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={modelsToUse}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
						zIndex={DROPDOWN_Z_INDEX - 2}
					/>

					{SUPPORTED_THINKING_MODELS.includes(selectedModelId) && (
						<ThinkingBudgetSlider currentMode={currentMode} maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
