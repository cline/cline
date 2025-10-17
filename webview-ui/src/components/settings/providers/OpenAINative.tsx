import type { OpenAiCompatibleModelInfo } from "@shared/api"
import { openAiNativeModels } from "@shared/api"
import type { OpenaiReasoningEffortOption } from "@shared/reasoning"
import { normalizeReasoningEffort, supportsReasoningEffortForModel } from "@shared/reasoning"
import { Mode } from "@shared/storage/types"
import { useEffect, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { ReasoningEffortDropdown } from "../common/ReasoningEffortDropdown"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the OpenAINativeProvider component
 */
interface OpenAINativeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The OpenAI (native) provider configuration component
 */
export const OpenAINativeProvider = ({ showModelOptions, isPopup, currentMode }: OpenAINativeProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const modeReasoningEffort = useMemo<OpenaiReasoningEffortOption | undefined>(() => {
		const effort =
			currentMode === "plan" ? apiConfiguration?.planModeReasoningEffort : apiConfiguration?.actModeReasoningEffort
		return normalizeReasoningEffort(effort)
	}, [apiConfiguration?.planModeReasoningEffort, apiConfiguration?.actModeReasoningEffort, currentMode])

	const isReasoningModel =
		supportsReasoningEffortForModel(selectedModelId) ||
		Boolean((selectedModelInfo as OpenAiCompatibleModelInfo)?.isReasoningModelFamily)
	const defaultReasoningEffort = useMemo<OpenaiReasoningEffortOption | undefined>(() => {
		const info = selectedModelInfo as { reasoningEffort?: string } | undefined
		return normalizeReasoningEffort(info?.reasoningEffort)
	}, [selectedModelInfo])

	useEffect(() => {
		if (isReasoningModel && !modeReasoningEffort && !defaultReasoningEffort) {
			handleModeFieldChange({ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" }, "medium", currentMode)
		}
	}, [isReasoningModel, modeReasoningEffort, defaultReasoningEffort, handleModeFieldChange, currentMode])

	const reasoningEffortValue: OpenaiReasoningEffortOption = modeReasoningEffort ?? defaultReasoningEffort ?? "medium"

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.openAiNativeApiKey || ""}
				onChange={(value) => handleFieldChange("openAiNativeApiKey", value)}
				providerName="OpenAI"
				signupUrl="https://platform.openai.com/api-keys"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={openAiNativeModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{isReasoningModel && (
						<ReasoningEffortDropdown
							onChange={(value) => {
								handleModeFieldChange(
									{ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" },
									value,
									currentMode,
								)
							}}
							value={reasoningEffortValue}
						/>
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
