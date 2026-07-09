import { type ModelInfo, vertexCustomModelInfoSaneDefaults, vertexGlobalModels, vertexModels } from "@shared/api"
import VertexData from "@shared/providers/vertex.json"
import type { Mode } from "@shared/storage/types"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DROPDOWN_Z_INDEX, DropdownContainer } from "../ApiOptions"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { LockIcon, RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
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
	"claude-sonnet-5",
	"claude-sonnet-5:1m",
	"claude-sonnet-4-6",
	"claude-sonnet-4-6:1m",
	"claude-fable-5",
	"claude-haiku-4-5",
	"claude-haiku-4-5@20251001",
	"claude-sonnet-4-5",
	"claude-sonnet-4-5@20250929",
	"claude-3-7-sonnet@20250219",
	"claude-sonnet-4@20250514",
	"claude-opus-4@20250514",
	"claude-opus-4-1",
	"claude-opus-4-1@20250805",
	"claude-opus-4-5",
	"claude-opus-4-6",
	"claude-opus-4-7",
	"claude-opus-4-8",
	"gemini-2.5-flash",
	"gemini-2.5-pro",
	"gemini-2.5-flash-lite-preview-06-17",
]

const REGIONS = VertexData.regions

/**
 * The GCP Vertex AI provider configuration component
 */
export const VertexProvider = ({ showModelOptions, isPopup, currentMode }: VertexProviderProps) => {
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(selectedModelId)
	const adaptiveThinkingDefaultEffort =
		resolveClaudeOpusAdaptiveThinking(modeFields.reasoningEffort, modeFields.thinkingBudgetTokens).effort ?? "none"

	// Determine which models to use based on region
	const modelsToUse = apiConfiguration?.vertexRegion === "global" ? vertexGlobalModels : vertexModels

	const isCustomModelSelected = !!modeFields.vertexCustomModelSelected
	const customModelInfo = modeFields.vertexCustomModelInfo ?? vertexCustomModelInfoSaneDefaults

	const handleCustomModelInfoChange = (updates: Partial<ModelInfo>) => {
		handleModeFieldChange(
			{ plan: "planModeVertexCustomModelInfo", act: "actModeVertexCustomModelInfo" },
			{ ...customModelInfo, ...updates },
			currentMode,
		)
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 5,
			}}>
			<RemotelyConfiguredInputWrapper hidden={remoteConfigSettings?.vertexProjectId === undefined}>
				<DebouncedTextField
					disabled={remoteConfigSettings?.vertexProjectId !== undefined}
					initialValue={apiConfiguration?.vertexProjectId || ""}
					onChange={(value) => handleFieldChange("vertexProjectId", value)}
					placeholder="Enter Project ID..."
					style={{ width: "100%" }}>
					<div className="flex items-center gap-2 mb-1">
						<span style={{ fontWeight: 500 }}>Google Cloud Project ID</span>
						{remoteConfigSettings?.vertexProjectId !== undefined && <LockIcon />}
					</div>
				</DebouncedTextField>
			</RemotelyConfiguredInputWrapper>

			<RemotelyConfiguredInputWrapper hidden={remoteConfigSettings?.vertexRegion === undefined}>
				<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 1}>
					<div
						className="flex items-center gap-2 mb-1"
						style={{ opacity: remoteConfigSettings?.vertexRegion !== undefined ? 0.4 : 1 }}>
						<label htmlFor="vertex-region-dropdown">
							<span className="font-medium">Google Cloud Region</span>
						</label>
						{remoteConfigSettings?.vertexRegion !== undefined && <LockIcon />}
					</div>
					<VSCodeDropdown
						disabled={remoteConfigSettings?.vertexRegion !== undefined}
						id="vertex-region-dropdown"
						onChange={(e: any) => handleFieldChange("vertexRegion", e.target.value)}
						style={{ width: "100%" }}
						value={apiConfiguration?.vertexRegion || ""}>
						<VSCodeOption value="">Select a region...</VSCodeOption>
						{REGIONS.map((region) => (
							<VSCodeOption key={region} value={region}>
								{region}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</DropdownContainer>
			</RemotelyConfiguredInputWrapper>

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
					<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 2}>
						<label htmlFor="vertex-model-dropdown">
							<span className="font-medium">Model</span>
						</label>
						<VSCodeDropdown
							className="w-full"
							id="vertex-model-dropdown"
							onChange={(e: any) => {
								const isCustom = e.target.value === "custom"

								handleModeFieldsChange(
									{
										apiModelId: { plan: "planModeApiModelId", act: "actModeApiModelId" },
										vertexCustomModelSelected: {
											plan: "planModeVertexCustomModelSelected",
											act: "actModeVertexCustomModelSelected",
										},
										vertexCustomModelInfo: {
											plan: "planModeVertexCustomModelInfo",
											act: "actModeVertexCustomModelInfo",
										},
									},
									{
										apiModelId: isCustom ? "" : e.target.value,
										vertexCustomModelSelected: isCustom,
										vertexCustomModelInfo: isCustom ? { ...vertexCustomModelInfoSaneDefaults } : undefined,
									},
									currentMode,
								)
							}}
							value={isCustomModelSelected ? "custom" : selectedModelId}>
							<VSCodeOption value="">Select a model...</VSCodeOption>
							{Object.keys(modelsToUse).map((modelId) => (
								<VSCodeOption
									className="whitespace-normal wrap-break-word max-w-full"
									key={modelId}
									value={modelId}>
									{modelId}
								</VSCodeOption>
							))}
							<VSCodeOption value="custom">Custom</VSCodeOption>
						</VSCodeDropdown>
					</DropdownContainer>

					{isCustomModelSelected && (
						<div>
							<p className="mt-1 text-sm text-description">
								Select "Custom" to use a Vertex AI model that isn't in the list. Enter the model ID and adjust the
								model's capabilities below if needed.
							</p>
							<DebouncedTextField
								className="w-full mt-0.5"
								id="vertex-custom-model-input"
								initialValue={modeFields.apiModelId || ""}
								onChange={(value) =>
									handleModeFieldChange(
										{ plan: "planModeApiModelId", act: "actModeApiModelId" },
										value,
										currentMode,
									)
								}
								placeholder="Enter custom model ID...">
								<span className="font-medium">Model ID</span>
							</DebouncedTextField>

							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								<DebouncedTextField
									initialValue={
										customModelInfo.contextWindow?.toString() ??
										vertexCustomModelInfoSaneDefaults.contextWindow?.toString() ??
										""
									}
									onChange={(value) => {
										// Only save valid values so clearing the field doesn't
										// snap it back to the previously saved value mid-edit.
										const parsed = Number.parseInt(value, 10)
										if (!Number.isNaN(parsed) && parsed > 0) {
											handleCustomModelInfoChange({ contextWindow: parsed })
										}
									}}
									style={{ flex: 1 }}>
									<span className="font-medium">Context Window Size</span>
								</DebouncedTextField>

								<DebouncedTextField
									initialValue={
										customModelInfo.maxTokens?.toString() ??
										vertexCustomModelInfoSaneDefaults.maxTokens?.toString() ??
										""
									}
									onChange={(value) => {
										const parsed = Number.parseInt(value, 10)
										if (!Number.isNaN(parsed) && parsed > 0) {
											handleCustomModelInfoChange({ maxTokens: parsed })
										}
									}}
									style={{ flex: 1 }}>
									<span className="font-medium">Max Output Tokens</span>
								</DebouncedTextField>
							</div>

							<div className="flex flex-col gap-1 mt-1">
								<VSCodeCheckbox
									checked={!!customModelInfo.supportsImages}
									onChange={(e: any) =>
										handleCustomModelInfoChange({ supportsImages: e.target.checked === true })
									}>
									Supports Images
								</VSCodeCheckbox>

								<VSCodeCheckbox
									checked={!!customModelInfo.supportsReasoning}
									onChange={(e: any) =>
										handleCustomModelInfoChange({ supportsReasoning: e.target.checked === true })
									}>
									Supports Reasoning
								</VSCodeCheckbox>
							</div>
						</div>
					)}

					{isAdaptiveThinkingModel ? (
						<ReasoningEffortSelector
							allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
							currentMode={currentMode}
							defaultEffort={adaptiveThinkingDefaultEffort}
							description="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
							label="Adaptive Thinking"
						/>
					) : SUPPORTED_THINKING_MODELS.includes(selectedModelId) ||
						(isCustomModelSelected && customModelInfo.supportsReasoning) ? (
						<ThinkingBudgetSlider currentMode={currentMode} maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					) : null}

					{selectedModelInfo.thinkingConfig?.supportsThinkingLevel && (
						<ReasoningEffortSelector currentMode={currentMode} />
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
