import { internationalZAiDefaultModelId, internationalZAiModels, mainlandZAiDefaultModelId, mainlandZAiModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the ZAiProvider component
 */
interface ZAiProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Z AI provider configuration component
 */
export const ZAiProvider = ({ showModelOptions, isPopup, currentMode }: ZAiProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Determine which models to use based on API line selection
	const zaiModels = useMemo(
		() => (apiConfiguration?.zaiApiLine === "china" ? mainlandZAiModels : internationalZAiModels),
		[apiConfiguration?.zaiApiLine],
	)

	// Determine default model ID based on API line selection
	const getDefaultModelId = (line: string | undefined) => {
		if (line === "china") {
			return mainlandZAiDefaultModelId;
		}
		return internationalZAiDefaultModelId; // Default to international if "china" is not set
	};

	const handleApiLineChange = (e: any) => {
		// VSCodeDropdown's onChange event might be a custom event or not directly React.FormEvent
		// Accessing the selected value might require different approach if e.currentTarget.value is not available
		// For now, assuming the event structure allows accessing the value
		// If this fails, we might need to inspect the actual event structure from VSCodeDropdown
		const newLine = e.target?.value || e.currentTarget?.value; // Try both e.target and e.currentTarget
		if (newLine === undefined) {
			console.error("Could not determine selected value from VSCodeDropdown event:", e);
			return;
		}
		handleFieldChange("zaiApiLine", newLine);

		// Reset apiModelId to the default for the new line
		const newDefaultModelId = getDefaultModelId(newLine);
		if (currentMode === "plan") {
			handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, newDefaultModelId, "plan");
		} else {
			handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, newDefaultModelId, "act");
		}
	};

	return (
		<div>
			<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
				<label htmlFor="zai-entrypoint">
					<span style={{ fontWeight: 500, marginTop: 5 }}>Z AI Entrypoint</span>
				</label>
				<VSCodeDropdown
					id="zai-entrypoint"
					onChange={handleApiLineChange}
					style={{
						minWidth: 130,
						position: "relative",
					}}
					value={apiConfiguration?.zaiApiLine || "international"}>
					<VSCodeOption value="international">api.z.ai</VSCodeOption>
					<VSCodeOption value="china">open.bigmodel.cn</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Please select the appropriate API entrypoint based on your location. If you are in China, choose open.bigmodel.cn
				. Otherwise, choose api.z.ai.
			</p>
			<ApiKeyField
				initialValue={apiConfiguration?.zaiApiKey || ""}
				onChange={(value) => handleFieldChange("zaiApiKey", value)}
				providerName="Z AI"
				signupUrl={
					apiConfiguration?.zaiApiLine === "china"
						? "https://open.bigmodel.cn/console/overview"
						: "https://z.ai/manage-apikey/apikey-list"
				}
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={zaiModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
