import { internationalZAiModels, mainlandZAiModels } from "@shared/api"
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
	const zaiModels = useMemo(() => {
		const isChinaRegion = apiConfiguration?.zaiApiLine?.startsWith("china") ?? false
		return isChinaRegion ? mainlandZAiModels : internationalZAiModels
	}, [apiConfiguration?.zaiApiLine])

	return (
		<div>
			<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
				<label htmlFor="zai-entrypoint">
					<span style={{ fontWeight: 500, marginTop: 5 }}>Z AI Entrypoint</span>
				</label>
				<VSCodeDropdown
					id="zai-entrypoint"
					onChange={(e) => handleFieldChange("zaiApiLine", (e.target as any).value)}
					style={{
						minWidth: 130,
						position: "relative",
					}}
					value={apiConfiguration?.zaiApiLine || "international"}>
					<VSCodeOption value="international">International Standard (api.z.ai)</VSCodeOption>
					<VSCodeOption value="international-coding">International Coding Plan (api.z.ai/coding)</VSCodeOption>
					<VSCodeOption value="china">China Standard (open.bigmodel.cn)</VSCodeOption>
					<VSCodeOption value="china-coding">China Coding Plan (open.bigmodel.cn/coding)</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Select the appropriate API entrypoint based on your location and subscription type. Choose "Coding Plan" if you
				have subscribed to a GLM Coding Plan (Lite/Pro), or "Standard" for pay-as-you-go API usage. Select "China"
				endpoints if you are in mainland China, otherwise choose "International" endpoints.
			</p>
			<ApiKeyField
				initialValue={apiConfiguration?.zaiApiKey || ""}
				onChange={(value) => handleFieldChange("zaiApiKey", value)}
				providerName="Z AI"
				signupUrl={
					apiConfiguration?.zaiApiLine?.startsWith("china")
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
