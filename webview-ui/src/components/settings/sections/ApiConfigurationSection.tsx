import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { TabButton } from "../../mcp/configuration/McpConfigurationView"
import ApiOptions from "../ApiOptions"
import Section from "../Section"
import { syncModeConfigurations } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ApiConfigurationSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
}

const ApiConfigurationSection = ({ renderSectionHeader }: ApiConfigurationSectionProps) => {
	const { t } = useTranslation()
	const { planActSeparateModelsSetting, mode, apiConfiguration } = useExtensionState()
	const [currentTab, setCurrentTab] = useState<Mode>(mode)
	const { handleFieldsChange } = useApiConfigurationHandlers()
	return (
		<div>
			{renderSectionHeader?.("api-config")}
			<Section>
				{/* Tabs container */}
				{planActSeparateModelsSetting ? (
					<div className="rounded-md mb-5">
						<div className="flex gap-px mb-[10px] -mt-2 border-0 border-b border-solid border-(--vscode-panel-border)">
							<TabButton
								disabled={currentTab === "plan"}
								isActive={currentTab === "plan"}
								onClick={() => setCurrentTab("plan")}
								style={{
									opacity: 1,
									cursor: "pointer",
								}}>
								{t("apiConfigSection.planMode")}
							</TabButton>
							<TabButton
								disabled={currentTab === "act"}
								isActive={currentTab === "act"}
								onClick={() => setCurrentTab("act")}
								style={{
									opacity: 1,
									cursor: "pointer",
								}}>
								{t("apiConfigSection.actMode")}
							</TabButton>
						</div>

						{/* Content container */}
						<div className="-mb-3">
							<ApiOptions currentMode={currentTab} showModelOptions={true} />
						</div>
					</div>
				) : (
					<ApiOptions currentMode={mode} showModelOptions={true} />
				)}

				<div className="mb-[5px]">
					<VSCodeCheckbox
						checked={planActSeparateModelsSetting}
						className="mb-[5px]"
						onChange={async (e: any) => {
							const checked = e.target.checked === true
							try {
								// If unchecking the toggle, wait a bit for state to update, then sync configurations
								if (!checked) {
									await syncModeConfigurations(apiConfiguration, currentTab, handleFieldsChange)
								}
								await StateServiceClient.updateSettings(
									UpdateSettingsRequest.create({
										planActSeparateModelsSetting: checked,
									}),
								)
							} catch (error) {
								console.error("Failed to update separate models setting:", error)
							}
						}}>
						{t("apiConfigSection.useDifferentModels")}
					</VSCodeCheckbox>
					<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
						{t("apiConfigSection.useDifferentModelsDescription")}
					</p>
				</div>
			</Section>
		</div>
	)
}

export default ApiConfigurationSection
