import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { vertexGlobalModels, vertexModels } from "@shared/api"
import VertexData from "@shared/providers/vertex.json"
import type { Mode } from "@shared/storage/types"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { useMemo } from "react"
import { ModelInfoView } from "../common/ModelInfoView"
import { ReasoningEffortSelector } from "../ReasoningEffortSelector"
import { ThinkingBudgetSlider } from "../ThinkingBudgetSlider"
import { ApiOptionsProps } from "../ApiOptions"

const REGIONS = VertexData.regions
const DROPDOWN_Z_INDEX = 1000

/**
 * VertexProvider renders the configuration UI for Google Cloud Vertex AI.
 * 
 * It supports independent region selection for Plan and Act modes to allow 
 * optimal routing for 1M context models.
 */
export const VertexProvider = ({
	apiConfiguration,
	handleFieldChange,
	handleModeFieldChange,
	remoteConfigSettings,
	currentMode,
	isPopup,
}: ApiOptionsProps & { currentMode: Mode }) => {
	const selectedModelId = (currentMode === "plan" ? apiConfiguration?.planModeApiModelId : apiConfiguration?.actModeApiModelId) || apiConfiguration?.modelId || ""
	
	const selectedModelInfo = useMemo(() => {
		return vertexModels[selectedModelId as keyof typeof vertexModels] || vertexModels[vertexGlobalModels[0] as keyof typeof vertexModels]
	}, [selectedModelId])

	const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(selectedModelId)
	const adaptiveThinkingDefaultEffort = resolveClaudeOpusAdaptiveThinking(
		currentMode === "plan" ? apiConfiguration?.planModeReasoningEffort : apiConfiguration?.actModeReasoningEffort,
		currentMode === "plan" ? apiConfiguration?.planModeThinkingBudgetTokens : apiConfiguration?.actModeThinkingBudgetTokens
	)?.effort

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
			<div>
				<div style={{ fontWeight: 500, fontSize: "12px", marginBottom: "4px" }}>
					Google Cloud Project ID
				</div>
				<VSCodeTextField
					value={apiConfiguration?.vertexProjectId || ""}
					onInput={(e: any) => handleFieldChange("vertexProjectId", e.target.value)}
					placeholder="Enter Project ID"
					style={{ width: "100%" }}
				/>
			</div>

			<div>
				<div style={{ fontWeight: 500, fontSize: "12px", marginBottom: "4px" }}>
					Google Cloud Region
				</div>
				<VSCodeDropdown
					id="vertex-region-dropdown"
					onChange={(e: any) =>
						handleModeFieldChange(
							{ plan: "planVertexRegion", act: "actVertexRegion" },
							e.target.value,
							currentMode,
						)
					}
					style={{ width: "100%" }}
					value={(currentMode === "plan" ? apiConfiguration?.planVertexRegion : apiConfiguration?.actVertexRegion) || apiConfiguration?.vertexRegion || ""}>
					<VSCodeOption value="">Select a region...</VSCodeOption>
					{REGIONS.map((region) => (
						<VSCodeOption key={region} value={region}>
							{region}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
			</div>

			{isAdaptiveThinkingModel ? (
				<>
					<ReasoningEffortSelector
						allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
						currentMode={currentMode}
						defaultEffort={adaptiveThinkingDefaultEffort}
						description="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
						label="Adaptive Thinking"
					/>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						<span style={{ fontWeight: 500 }}>Pro Tip:</span> Adaptive Thinking allows the model to
						dynamically allocate reasoning depth. Use <span style={{ fontStyle: "italic" }}>xhigh</span> for
						complex architectural changes and <span style={{ fontStyle: "italic" }}>low</span> for simple
						file listing or boilerplate.
					</p>

					<div style={{ marginTop: "10px" }}>
						<div style={{ fontWeight: 500, fontSize: "12px", marginBottom: "4px" }}>
							Task Budget (Loop-wide)
						</div>
						<VSCodeTextField
							value={apiConfiguration?.taskBudgetTokens?.toString() || "100000"}
							onInput={(e: any) => handleFieldChange("taskBudgetTokens", parseInt(e.target.value))}
							placeholder="Tokens (Min 20,000)"
							style={{ width: "100%" }}
						/>
						<p style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", marginTop: "4px" }}>
							Advisory limit for the total agentic loop. Opus 4.7 uses this to self-regulate spend.
						</p>
					</div>
				</>
			) : (
				<ThinkingBudgetSlider 
					currentMode={currentMode} 
					maxBudget={selectedModelInfo?.thinkingConfig?.maxBudget} 
				/>
			)}

			<ModelInfoView 
				isPopup={isPopup} 
				modelInfo={selectedModelInfo} 
				selectedModelId={selectedModelId} 
			/>
		</div>
	)
}
