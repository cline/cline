import { burncloudModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the BurnCloudProvider component
 */
interface BurnCloudProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The BurnCloud provider configuration component
 */
export const BurnCloudProvider = ({ showModelOptions, isPopup, currentMode }: BurnCloudProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.burncloudApiKey || ""}
				onChange={(value) => handleFieldChange("burncloudApiKey", value)}
				providerName="BurnCloud"
				signupUrl="https://docs.burncloud.com/books/api"
			/>

			<VSCodeTextField
				onInput={(e: any) => handleFieldChange("burncloudBaseUrl", e.target.value)}
				placeholder="https://ai.burncloud.com/v1"
				style={{ width: "100%", marginTop: "10px" }}
				value={apiConfiguration?.burncloudBaseUrl || "https://ai.burncloud.com/v1"}>
				<span style={{ fontWeight: "500" }}>Base URL (可选)</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				默认: https://ai.burncloud.com/v1
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						label="模型"
						models={burncloudModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeBurncloudModelId", act: "actModeBurncloudModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />

					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						支持 Claude 和 GPT 系列模型
					</p>
				</>
			)}
		</div>
	)
}
