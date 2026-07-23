import { QwenApiRegions } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { DROPDOWN_Z_INDEX } from "../ApiOptions"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

const SUPPORTED_THINKING_MODELS = [
	"qwen3-235b-a22b",
	"qwen3-32b",
	"qwen3-30b-a3b",
	"qwen3-14b",
	"qwen3-8b",
	"qwen3-4b",
	"qwen3-1.7b",
	"qwen3-0.6b",
	"qwen-plus-latest",
	"qwen-turbo-latest",
]

/**
 * Props for the QwenProvider component
 */
interface QwenProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

// Turns enum into an array of values for dropdown options
const qwenApiOptions: QwenApiRegions[] = Object.values(QwenApiRegions)

/**
 * The Alibaba Qwen provider configuration component
 */
export const QwenProvider = ({ showModelOptions, isPopup, currentMode }: QwenProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Catalog and default come from the SDK via gRPC. The SDK consumes
	// `apiLine` from the effective provider config so regional selection
	// (china vs international) happens upstream — the webview sees a
	// single catalog per render.
	const { models, selectedModelId, selectedModelInfo, hideUsageCost } = useStaticProviderSelection(
		"qwen",
		apiConfiguration,
		currentMode,
	)

	return (
		<div>
			<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
				<label htmlFor="qwen-line-provider">
					<span style={{ fontWeight: 500, marginTop: 5 }}>Alibaba API Line</span>
				</label>
				<VSCodeDropdown
					id="qwen-line-provider"
					onChange={(e: any) => handleFieldChange("qwenApiLine", e.target.value as QwenApiRegions)}
					style={{
						minWidth: 130,
						position: "relative",
					}}
					value={apiConfiguration?.qwenApiLine || qwenApiOptions[0]}>
					{qwenApiOptions.map((line) => (
						<VSCodeOption key={line} value={line}>
							{line.charAt(0).toUpperCase() + line.slice(1)} API
						</VSCodeOption>
					))}
				</VSCodeDropdown>
			</DropdownContainer>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Please select the appropriate API interface based on your location. If you are in China, choose the China API
				interface. Otherwise, choose the International API interface.
			</p>

			<ApiKeyField
				initialValue={apiConfiguration?.qwenApiKey || ""}
				onChange={(value) => handleFieldChange("qwenApiKey", value)}
				providerName="Qwen"
				signupUrl="https://bailian.console.aliyun.com/"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="模型"
						models={models}
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
