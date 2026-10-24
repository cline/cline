import { StringRequest } from "@shared/proto/cline/common"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { CloudIcon, MonitorIcon } from "lucide-react"
import { useState } from "react"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CloudServiceClient, StateServiceClient } from "@/services/grpc-client"
import { TargetButton } from "../../cloud/TaskTargetPanel"
import { TabButton } from "../../mcp/configuration/McpConfigurationView"
import ApiOptions from "../ApiOptions"
import ClineModelPicker from "../ClineModelPicker"
import Section from "../Section"
import { syncModeConfigurations } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ApiConfigurationSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
	initialModelTab?: "recommended" | "free"
}

const ApiConfigurationSection = ({ renderSectionHeader, initialModelTab }: ApiConfigurationSectionProps) => {
	const { cloudSessionsEnabled, cloudTaskTarget, currentCloudTask, clineMessages } = useExtensionState()
	const showCloud = !!cloudSessionsEnabled || !!currentCloudTask
	// Open on the settings for where the chat view is about to run (or is running) a task.
	const [target, setTarget] = useState<"local" | "cloud">(() =>
		currentCloudTask || (cloudSessionsEnabled && clineMessages.length === 0 && cloudTaskTarget?.target === "cloud")
			? "cloud"
			: "local",
	)
	const isCloud = showCloud && target === "cloud"

	return (
		<div>
			{renderSectionHeader?.("api-config")}
			<Section>
				{showCloud && (
					<div
						aria-label="Model settings for"
						className="inline-flex self-start rounded-lg border border-input-foreground/20 p-1 mb-1"
						role="radiogroup">
						<TargetButton
							active={!isCloud}
							icon={<MonitorIcon className="size-3" />}
							label="Local"
							onClick={() => setTarget("local")}
						/>
						<TargetButton
							active={isCloud}
							icon={<CloudIcon className="size-3" />}
							label="Cloud"
							onClick={() => setTarget("cloud")}
						/>
					</div>
				)}
				{isCloud ? <CloudModelSettings /> : <LocalModelSettings initialModelTab={initialModelTab} />}
			</Section>
		</div>
	)
}

const LocalModelSettings = ({ initialModelTab }: Pick<ApiConfigurationSectionProps, "initialModelTab">) => {
	const { planActSeparateModelsSetting, mode, apiConfiguration } = useExtensionState()
	const [currentTab, setCurrentTab] = useState<Mode>(mode)
	const { handleFieldsChange } = useApiConfigurationHandlers()
	return (
		<>
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
						<ApiOptions currentMode={currentTab} initialModelTab={initialModelTab} showModelOptions={true} />
					</div>
				</div>
			) : (
				<ApiOptions currentMode={mode} initialModelTab={initialModelTab} showModelOptions={true} />
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
					Use different models for Plan and Act modes
				</VSCodeCheckbox>
				<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
					Switching between Plan and Act mode will persist the API and model used in the previous mode. This may be
					helpful e.g. when using a strong reasoning model to architect a plan for a cheaper coding model to act on.
				</p>
			</div>
		</>
	)
}

const CloudModelSettings = () => {
	const { nextCloudModelId, cloudModelId, currentCloudTask } = useExtensionState()
	const { activeOrganization } = useClineAuth()
	const runningModelId = currentCloudTask ? cloudModelId : undefined
	return (
		<>
			<p className="text-xs m-0 text-(--vscode-descriptionForeground)">
				Cloud tasks run in an isolated sandbox on a Cline model. Usage-Billing models use Cline credits
				{activeOrganization ? "" : ", ClinePass models use your subscription,"} and ClineFree models are free with limited
				usage. This model is separate from your local Plan and Act models.
			</p>
			{runningModelId && (
				<p className="text-xs m-0 text-(--vscode-descriptionForeground)">
					The current cloud task runs on <code>{runningModelId}</code>. A model change applies to the next cloud task.
				</p>
			)}
			<ClineModelPicker
				cloudSelection={{
					includeClinePass: !activeOrganization,
					modelId: nextCloudModelId ?? "",
					onChange: (modelId) =>
						CloudServiceClient.setCloudModel(StringRequest.create({ value: modelId })).catch((error) =>
							console.error("Failed to save cloud model:", error),
						),
				}}
				currentMode="act"
			/>
		</>
	)
}

export default ApiConfigurationSection
