import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { TabButton } from "../../mcp/configuration/McpConfigurationView"
import ApiOptions from "../ApiOptions"
import Section from "../Section"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { UpdateSettingsRequest } from "@shared/proto/state"

interface ApiConfigurationSectionProps {
	isSwitchingMode: boolean
	handlePlanActModeChange: (mode: "plan" | "act") => Promise<void>
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const ApiConfigurationSection = ({
	isSwitchingMode,
	handlePlanActModeChange,
	renderSectionHeader,
}: ApiConfigurationSectionProps) => {
	const { planActSeparateModelsSetting, chatSettings } = useExtensionState()
	return (
		<div>
			{renderSectionHeader("api-config")}
			<Section>
				{/* Tabs container */}
				{planActSeparateModelsSetting ? (
					<div className="rounded-md mb-5 bg-[var(--vscode-panel-background)]">
						<div className="flex gap-[1px] mb-[10px] -mt-2 border-0 border-b border-solid border-[var(--vscode-panel-border)]">
							<TabButton
								isActive={chatSettings.mode === "plan"}
								onClick={() => handlePlanActModeChange("plan")}
								disabled={isSwitchingMode}
								style={{
									opacity: isSwitchingMode ? 0.6 : 1,
									cursor: isSwitchingMode ? "not-allowed" : "pointer",
								}}>
								{isSwitchingMode && chatSettings.mode === "act" ? "Switching..." : "Plan Mode"}
							</TabButton>
							<TabButton
								isActive={chatSettings.mode === "act"}
								onClick={() => handlePlanActModeChange("act")}
								disabled={isSwitchingMode}
								style={{
									opacity: isSwitchingMode ? 0.6 : 1,
									cursor: isSwitchingMode ? "not-allowed" : "pointer",
								}}>
								{isSwitchingMode && chatSettings.mode === "plan" ? "Switching..." : "Act Mode"}
							</TabButton>
						</div>

						{/* Content container */}
						<div className="-mb-3">
							<ApiOptions showModelOptions={true} />
						</div>
					</div>
				) : (
					<ApiOptions showModelOptions={true} />
				)}

				<div className="mb-[5px]">
					<VSCodeCheckbox
						className="mb-[5px]"
						checked={planActSeparateModelsSetting}
						onChange={async (e: any) => {
							const checked = e.target.checked === true
							try {
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
					<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
						Switching between Plan and Act mode will persist the API and model used in the previous mode. This may be
						helpful e.g. when using a strong reasoning model to architect a plan for a cheaper coding model to act on.
					</p>
				</div>
			</Section>
		</div>
	)
}

export default ApiConfigurationSection
