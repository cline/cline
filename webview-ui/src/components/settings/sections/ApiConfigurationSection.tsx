import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { TabButton } from "../../mcp/configuration/McpConfigurationView"
import ApiOptions from "../ApiOptions"
import Section from "../Section"
import { syncModeConfigurations } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ApiConfigurationSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const ApiConfigurationSection = ({ renderSectionHeader }: ApiConfigurationSectionProps) => {
	const { planActSeparateModelsSetting, mode, apiConfiguration } = useExtensionState()
	const [currentTab, setCurrentTab] = useState<Mode>(mode)
	const { handleFieldsChange } = useApiConfigurationHandlers()
	return (
		<div>
			{renderSectionHeader("api-config")}
			<Section>
				{/* Tabs container */}
				{planActSeparateModelsSetting ? (
					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-symbol-misc" />
							Mode Configuration
						</div>
						<div className="flex gap-[1px] mb-[10px] -mt-2 border-0 border-b border-solid border-[var(--vscode-panel-border)]">
							<TabButton
								disabled={currentTab === "plan"}
								isActive={currentTab === "plan"}
								onClick={() => setCurrentTab("plan")}
								style={{
									opacity: 1,
									cursor: "pointer",
								}}>
								Plan Mode
							</TabButton>
							<TabButton
								disabled={currentTab === "act"}
								isActive={currentTab === "act"}
								onClick={() => setCurrentTab("act")}
								style={{
									opacity: 1,
									cursor: "pointer",
								}}>
								Act Mode
							</TabButton>
						</div>

						{/* Content container */}
						<div className="-mb-3">
							<ApiOptions currentMode={currentTab} showModelOptions={true} />
						</div>
					</div>
				) : (
					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-plug" />
							API Provider
						</div>
						<ApiOptions currentMode={mode} showModelOptions={true} />
					</div>
				)}

				<div className="settings-card">
					<div className="settings-section-header">
						<span className="codicon codicon-gear" />
						Mode Settings
					</div>
					<div className="settings-toggle-row">
						<VSCodeCheckbox
							checked={planActSeparateModelsSetting}
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
							Use different models for Plan and Act modes
						</VSCodeCheckbox>
					</div>
					<p className="toggle-description">
						Switching between Plan and Act mode will persist the API and model used in the previous mode. This may be
						helpful e.g. when using a strong reasoning model to architect a plan for a cheaper coding model to act on.
					</p>
				</div>
			</Section>
		</div>
	)
}

export default ApiConfigurationSection
