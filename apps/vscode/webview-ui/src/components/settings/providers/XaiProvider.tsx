import { openAiModelInfoSafeDefaults } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { DROPDOWN_Z_INDEX } from "../ApiOptions"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

const PROVIDER_ID = "xai"

// VSCodeDropdown's onChange supplies `Event | React.FormEvent<HTMLElement>`,
// so accept the same union here. We only read `target.value`, which is present
// on both, so no narrowing of the event itself is required.
function getEventValue(event: Event | React.FormEvent<HTMLElement>): string {
	const target = event.target
	if (target && "value" in target && typeof target.value === "string") {
		return target.value
	}
	return ""
}

/**
 * Props for the XaiProvider component
 */
interface XaiProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const XaiProvider = ({ showModelOptions, isPopup, currentMode }: XaiProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig(PROVIDER_ID)

	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)

	// Get the normalized configuration
	const {
		models,
		defaultModelId,
		selectedModelId: legacySelectedModelId,
		selectedModelInfo: legacySelectedModelInfo,
		hideUsageCost,
	} = useStaticProviderSelection(PROVIDER_ID, apiConfiguration, currentMode)
	const { selectedModelId, selectedModelInfo, commitModelSelection } = useProviderModelSelection(PROVIDER_ID, currentMode, {
		models,
		defaultModelId: legacySelectedModelId,
		config,
		commitSelection,
		fallbackModelInfo: legacySelectedModelInfo,
	})

	// Local state for reasoning effort toggle
	const [reasoningEffortSelected, setReasoningEffortSelected] = useState(!!modeFields.reasoningEffort)
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "X AI",
		write,
	})

	const handleModelChange = (modelId: string) => {
		if (!modelId) {
			return
		}

		const fallbackModelId = defaultModelId || Object.keys(models)[0] || modelId
		const modelInfo = models[modelId] ?? models[fallbackModelId] ?? selectedModelInfo ?? openAiModelInfoSafeDefaults

		void commitModelSelection({
			modelId,
			modelInfo,
		}).catch((err) => console.error("Failed to commit X AI model selection:", err))
	}

	const handleReasoningEffortChange = (effort: string) => {
		void write({ reasoning: { enabled: true, effort } }).catch((err) =>
			console.error("Failed to update X AI reasoning effort:", err),
		)
		handleModeFieldChange({ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" }, effort, currentMode)
	}

	const handleReasoningEffortDisabled = () => {
		void write({ reasoning: { enabled: false, effort: "none" } }).catch((err) =>
			console.error("Failed to disable X AI reasoning effort:", err),
		)
		handleModeFieldChange({ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" }, "", currentMode)
	}

	return (
		<div>
			<div>
				<ApiKeyField
					initialValue={savedApiKeyMask || apiConfiguration?.xaiApiKey || ""}
					onChange={handleApiKeyChange}
					providerName="X AI"
					signupUrl="https://x.ai"
				/>
				<p
					style={{
						fontSize: "12px",
						marginTop: -10,
						color: "var(--vscode-descriptionForeground)",
					}}>
					<span style={{ color: "var(--vscode-errorForeground)" }}>
						(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts, so behavior can vary across
						models. Less capable models may not work as expected.)
					</span>
				</p>
			</div>

			{showModelOptions && (
				<>
					<ModelSelector
						label="模型"
						models={models}
						onChange={(event: Event) => handleModelChange(getEventValue(event))}
						selectedModelId={selectedModelId}
					/>

					{selectedModelId && selectedModelId.includes("3-mini") && (
						<>
							<VSCodeCheckbox
								checked={reasoningEffortSelected}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									setReasoningEffortSelected(isChecked)
									if (!isChecked) {
										handleReasoningEffortDisabled()
									}
								}}
								style={{ marginTop: 0 }}>
								Modify reasoning effort
							</VSCodeCheckbox>

							{reasoningEffortSelected && (
								<div>
									<label htmlFor="reasoning-effort-dropdown">
										<span style={{}}>Reasoning Effort</span>
									</label>
									<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 100}>
										<VSCodeDropdown
											id="reasoning-effort-dropdown"
											onChange={(event) => handleReasoningEffortChange(getEventValue(event))}
											style={{ width: "100%", marginTop: 3 }}
											value={modeFields.reasoningEffort || "high"}>
											<VSCodeOption value="low">low</VSCodeOption>
											<VSCodeOption value="high">high</VSCodeOption>
										</VSCodeDropdown>
									</DropdownContainer>
									<p
										style={{
											fontSize: "12px",
											marginTop: 3,
											marginBottom: 0,
											color: "var(--vscode-descriptionForeground)",
										}}>
										High effort may produce more thorough analysis but takes longer and uses more tokens.
									</p>
								</div>
							)}
						</>
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
