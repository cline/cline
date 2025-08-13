import { xaiModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DROPDOWN_Z_INDEX } from "../ApiOptions"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

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
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Local state for reasoning effort toggle
	const [reasoningEffortSelected, setReasoningEffortSelected] = useState(!!modeFields.reasoningEffort)

	return (
		<div>
			<div>
				<ApiKeyField
					initialValue={apiConfiguration?.xaiApiKey || ""}
					onChange={(value) => handleFieldChange("xaiApiKey", value)}
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
						(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude
						models. Less capable models may not work as expected.)
					</span>
				</p>
			</div>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={xaiModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
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
										handleModeFieldChange(
											{ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" },
											"",
											currentMode,
										)
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
											onChange={(e: any) => {
												handleModeFieldChange(
													{ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" },
													e.target.value,
													currentMode,
												)
											}}
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

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
