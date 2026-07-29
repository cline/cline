import VertexData from "@shared/providers/vertex.json"
import type { Mode } from "@shared/storage/types"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { useProviderUsageCostDisplay } from "@/hooks/useProviderUsageCostDisplay"
import { DROPDOWN_Z_INDEX, DropdownContainer } from "../ApiOptions"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { LockIcon, RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getModeSpecificFields } from "../utils/providerUtils"

/**
 * Props for the VertexProvider component
 */
interface VertexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

const REGIONS = VertexData.regions

/**
 * The GCP Vertex AI provider configuration component
 */
export const VertexProvider = ({ showModelOptions, isPopup, currentMode }: VertexProviderProps) => {
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()
	const { models: allVertexModels, defaultModelId } = useProviderModels("vertex")
	const { config, write, commitSelection } = useProviderConfig("vertex")
	const { selectedModel, selectedModelId, selectedModelInfo, commitModelSelection } = useProviderModelSelection(
		"vertex",
		currentMode,
		{
			models: allVertexModels,
			defaultModelId,
			config,
			commitSelection,
		},
	)
	const hideUsageCost = useProviderUsageCostDisplay("vertex") === "hide"
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const vertexProjectId = config?.gcp?.projectId ?? apiConfiguration?.vertexProjectId ?? ""
	const vertexRegion = config?.gcp?.region ?? config?.region ?? apiConfiguration?.vertexRegion ?? ""

	const writeProviderConfig = (patch: Parameters<typeof write>[0], label: string) => {
		void write(patch).catch((err) => console.error(`Failed to update Vertex ${label}:`, err))
	}
	const writeGcp = (gcp: NonNullable<Parameters<typeof write>[0]["gcp"]>, label: string) => {
		writeProviderConfig({ gcp }, label)
	}

	const handleProjectIdChange = (value: string) => {
		writeGcp({ projectId: value }, "project ID")
	}

	const handleRegionChange = (value: string) => {
		writeProviderConfig({ region: value, gcp: { region: value } }, "region")
	}

	// Catalog and selection come from the SDK via gRPC. Vertex carries a
	// per-model `supportsGlobalEndpoint` flag (populated host-side from
	// the allowlist in
	// `apps/vscode/src/sdk/model-catalog/vertex-global-endpoint.ts`).
	// When the user selects `vertexRegion === "global"` the picker is
	// filtered to only models known to work with that endpoint so the
	// runtime cannot produce a `model not available in region: global`
	// error from a user-pickable combination.
	const modelsToUse = useMemo(() => {
		if (vertexRegion !== "global") {
			return allVertexModels
		}
		return Object.fromEntries(Object.entries(allVertexModels).filter(([, info]) => info.supportsGlobalEndpoint === true))
	}, [allVertexModels, vertexRegion])
	const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(selectedModelId)
	const supportsThinkingBudget =
		selectedModelInfo.supportsReasoning === true &&
		selectedModelInfo.thinkingConfig !== undefined &&
		selectedModelInfo.thinkingConfig.supportsThinkingLevel !== true
	const adaptiveThinkingDefaultEffort =
		resolveClaudeOpusAdaptiveThinking(modeFields.reasoningEffort, modeFields.thinkingBudgetTokens).effort ?? "none"

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
					initialValue={vertexProjectId}
					onChange={handleProjectIdChange}
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
						onChange={(e: any) => handleRegionChange(e.target.value)}
						style={{ width: "100%" }}
						value={vertexRegion}>
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
					<ModelSelector
						label="Model"
						models={modelsToUse}
						onChange={(e: any) => {
							const modelId = e.target.value
							void commitModelSelection({
								modelId,
								modelInfo: modelsToUse[modelId] ?? selectedModel.modelInfo,
							}).catch((err) => console.error("Failed to commit Vertex model selection:", err))
						}}
						selectedModelId={selectedModelId}
						zIndex={DROPDOWN_Z_INDEX - 2}
					/>

					{isAdaptiveThinkingModel ? (
						<ReasoningEffortSelector
							allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
							currentMode={currentMode}
							defaultEffort={adaptiveThinkingDefaultEffort}
							description="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
							label="Adaptive Thinking"
						/>
					) : supportsThinkingBudget ? (
						<ThinkingBudgetSlider currentMode={currentMode} maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					) : null}

					{selectedModelInfo.thinkingConfig?.supportsThinkingLevel && (
						<ReasoningEffortSelector currentMode={currentMode} />
					)}

					<ModelInfoView
						hideUsageCost={hideUsageCost}
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						selectedModelId={selectedModelId}
					/>
				</>
			)}
		</div>
	)
}
