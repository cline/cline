import { vertexGlobalModels, vertexModels } from "@shared/api"
import { VSCodeDropdown, VSCodeOption, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { DropdownContainer, DROPDOWN_Z_INDEX } from "../ApiOptions"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useState, useEffect } from "react"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { Mode } from "@shared/storage/types"
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
const PREDEFINED_REGIONS = ["us-east5", "us-central1", "europe-west1", "europe-west4", "asia-southeast1", "global"]

/**
 * The GCP Vertex AI provider configuration component
 */
export const VertexProvider = ({ showModelOptions, isPopup, currentMode }: VertexProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Check if current region is predefined
	const isCurrentRegionPredefined =
		!apiConfiguration?.vertexRegion || PREDEFINED_REGIONS.includes(apiConfiguration.vertexRegion)

	const [isCustomRegion, setIsCustomRegion] = useState(!isCurrentRegionPredefined)

	// Auto-adjust custom state when configuration changes
	useEffect(() => {
		const isPredefined = !apiConfiguration?.vertexRegion || PREDEFINED_REGIONS.includes(apiConfiguration.vertexRegion)
		setIsCustomRegion(!isPredefined)
	}, [apiConfiguration?.vertexRegion])

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Determine which models to use based on region
	const modelsToUse = apiConfiguration?.vertexRegion === "global" ? vertexGlobalModels : vertexModels

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
				style={{ width: "100%" }}
				placeholder="Enter Project ID...">
				<span style={{ fontWeight: 500 }}>Google Cloud Project ID</span>
			</DebouncedTextField>

			<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 1} className="dropdown-container">
				<label htmlFor="vertex-region-dropdown">
					<span style={{ fontWeight: 500 }}>Google Cloud Region</span>
				</label>
				<VSCodeDropdown
					id="vertex-region-dropdown"
					value={isCustomRegion ? "custom" : apiConfiguration?.vertexRegion || ""}
					style={{ width: "100%" }}
					onChange={(e: any) => {
						const value = e.target.value
						if (value === "custom") {
							setIsCustomRegion(true)
							// Don't clear existing value, let user modify in input field
						} else {
							setIsCustomRegion(false)
							handleFieldChange("vertexRegion", value)
						}
					}}>
					<VSCodeOption value="">Select a region...</VSCodeOption>
					<VSCodeOption value="us-east5">us-east5</VSCodeOption>
					<VSCodeOption value="us-central1">us-central1</VSCodeOption>
					<VSCodeOption value="europe-west1">europe-west1</VSCodeOption>
					<VSCodeOption value="europe-west4">europe-west4</VSCodeOption>
					<VSCodeOption value="asia-southeast1">asia-southeast1</VSCodeOption>
					<VSCodeOption value="global">global</VSCodeOption>
					<VSCodeOption value="custom">Custom...</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>

			{/* Custom region input field */}
			{isCustomRegion && (
				<DebouncedTextField
					initialValue={apiConfiguration?.vertexRegion || ""}
					onChange={(value) => handleFieldChange("vertexRegion", value)}
					style={{ width: "100%", marginTop: 5 }}
					placeholder="e.g., us-west1, europe-west2, asia-northeast1">
					<span style={{ fontWeight: 500 }}>Custom Region</span>
				</DebouncedTextField>
			)}

			{/* Custom region help text */}
			{isCustomRegion && (
				<p
					style={{
						fontSize: "11px",
						marginTop: "5px",
						marginBottom: "10px",
						color: "var(--vscode-descriptionForeground)",
						fontStyle: "italic",
					}}>
					💡 See{" "}
					<VSCodeLink
						href="https://cloud.google.com/vertex-ai/docs/general/locations"
						style={{ display: "inline", fontSize: "inherit" }}>
						Vertex AI regions
					</VSCodeLink>{" "}
					for all available options.
				</p>
			)}

			{/* General setup instructions */}
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				To use Google Cloud Vertex AI, you need to{" "}
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
						models={modelsToUse}
						selectedModelId={selectedModelId}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						label="Model"
						zIndex={DROPDOWN_Z_INDEX - 2}
					/>

					{SUPPORTED_THINKING_MODELS.includes(selectedModelId) && (
						<ThinkingBudgetSlider maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} currentMode={currentMode} />
					)}

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
