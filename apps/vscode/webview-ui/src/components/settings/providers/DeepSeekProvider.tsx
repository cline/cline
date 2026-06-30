import { modelsDevDeepSeekModels } from "@shared/models/models-dev-catalog";
import type { Mode } from "@shared/storage/types";
import { useExtensionState } from "@/context/ExtensionStateContext";
import { ApiKeyField } from "../common/ApiKeyField";
import { ModelInfoView } from "../common/ModelInfoView";
import { ModelSelector } from "../common/ModelSelector";
import ReasoningEffortSelector from "../ReasoningEffortSelector";
import { normalizeApiConfiguration } from "../utils/providerUtils";
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers";

const DEEPSEEK_REASONING_EFFORT_MODELS = new Set([
	"deepseek-v4-flash",
	"deepseek-v4-pro",
	"deepseek-reasoner",
]);

/**
 * Props for the DeepSeekProvider component
 */
interface DeepSeekProviderProps {
	showModelOptions: boolean;
	isPopup?: boolean;
	currentMode: Mode;
}

/**
 * The DeepSeek provider configuration component
 */
export const DeepSeekProvider = ({
	showModelOptions,
	isPopup,
	currentMode,
}: DeepSeekProviderProps) => {
	const { apiConfiguration } = useExtensionState();
	const { handleFieldChange, handleModeFieldChange } =
		useApiConfigurationHandlers();

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(
		apiConfiguration,
		currentMode,
	);
	const showReasoningEffort =
		DEEPSEEK_REASONING_EFFORT_MODELS.has(selectedModelId);

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
						models={modelsDevDeepSeekModels}
						onChange={(e) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{showReasoningEffort && (
						<ReasoningEffortSelector currentMode={currentMode} />
					)}

					<ModelInfoView
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						selectedModelId={selectedModelId}
					/>
				</>
			)}
		</div>
	);
};
