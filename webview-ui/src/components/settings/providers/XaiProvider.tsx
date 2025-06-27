import { ApiConfiguration, xaiModels } from "@shared/api"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector, DropdownContainer } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { DROPDOWN_Z_INDEX } from "../ApiOptions"

/**
 * Props for the XaiProvider component
 */
interface XaiProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
	setApiConfiguration: (config: ApiConfiguration) => void
}

/**
 * The xAI provider configuration component
 */
export const XaiProvider = ({
	apiConfiguration,
	handleInputChange,
	showModelOptions,
	isPopup,
	setApiConfiguration,
}: XaiProviderProps) => {
	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Local state for reasoning effort toggle
	const [reasoningEffortSelected, setReasoningEffortSelected] = useState(!!apiConfiguration?.reasoningEffort)

	return (
		<div>
			<div>
				<ApiKeyField
					value={apiConfiguration?.xaiApiKey || ""}
					onChange={handleInputChange("xaiApiKey")}
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
						models={xaiModels}
						selectedModelId={selectedModelId}
						onChange={handleInputChange("apiModelId")}
						label="Model"
					/>

					{selectedModelId && selectedModelId.includes("3-mini") && (
						<>
							<VSCodeCheckbox
								style={{ marginTop: 0 }}
								checked={reasoningEffortSelected}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									setReasoningEffortSelected(isChecked)
									if (!isChecked) {
										setApiConfiguration({
											...apiConfiguration,
											reasoningEffort: "",
										})
									}
								}}>
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
											style={{ width: "100%", marginTop: 3 }}
											value={apiConfiguration?.reasoningEffort || "high"}
											onChange={(e: any) => {
												setApiConfiguration({
													...apiConfiguration,
													reasoningEffort: e.target.value,
												})
											}}>
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

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
