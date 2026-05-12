import { deepSeekModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { resolveDeepSeekAdaptiveThinking } from "@shared/utils/reasoning-support"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the DeepSeekProvider component
 */
interface DeepSeekProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The DeepSeek provider configuration component
 */
export const DeepSeekProvider = ({ showModelOptions, isPopup, currentMode }: DeepSeekProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const isV4Model = selectedModelId?.startsWith("deepseek-v4") ?? false
	const [enableThinking, setEnableThinking] = useState(!!modeFields.reasoningEffort)
	const adaptiveThinking = resolveDeepSeekAdaptiveThinking(modeFields.reasoningEffort)

	useEffect(() => {
		setEnableThinking(!!modeFields.reasoningEffort)
	}, [modeFields.reasoningEffort])

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.deepSeekApiKey || ""}
				onChange={(value) => handleFieldChange("deepSeekApiKey", value)}
				providerName="DeepSeek"
				signupUrl="https://www.deepseek.com/"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={deepSeekModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{isV4Model ? (
						<>
							<div style={{ marginTop: 8 }}>
								<VSCodeCheckbox
									checked={enableThinking}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										setEnableThinking(checked)
										handleModeFieldChange(
											{ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" },
											checked ? modeFields.reasoningEffort || "high" : "",
											currentMode,
										)
									}}>
									Enable Thinking
								</VSCodeCheckbox>
							</div>
							{enableThinking && (
								<ReasoningEffortSelector
									allowedEfforts={["high", "xhigh"] as const}
									currentMode={currentMode}
									defaultEffort={adaptiveThinking.effort ?? "high"}
									description="Use None to disable thinking. Higher effort increases response detail and token usage."
									label="Thinking Level"
								/>
							)}
						</>
					) : null}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
