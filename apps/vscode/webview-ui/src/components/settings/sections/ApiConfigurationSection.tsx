import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { CloudIcon, MonitorIcon, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useClinePassPromo } from "@/hooks/useClinePassPromo"
import { CloudServiceClient, StateServiceClient } from "@/services/grpc-client"
import { TargetButton } from "../../cloud/TaskTargetPanel"
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
	const { cloudSessionsEnabled, cloudTaskTarget, currentCloudTask, clineMessages, mode } = useExtensionState()
	const showCloud = !!cloudSessionsEnabled || !!currentCloudTask
	const [target, setTarget] = useState<"local" | "cloud">(() =>
		currentCloudTask || (cloudSessionsEnabled && clineMessages.length === 0 && cloudTaskTarget?.target === "cloud")
			? "cloud"
			: "local",
	)
	const isCloud = showCloud && target === "cloud"
	const [currentTab, setCurrentTab] = useState<Mode>(mode)

	return (
		<div>
			{renderSectionHeader?.("api-config")}
			<Section>
				{showCloud && (
					<div
						aria-label="Model settings for"
						className="inline-flex self-start rounded-lg bg-[#151618] border border-white/[0.08] p-1"
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
				{isCloud ? (
					<CloudModelSettings />
				) : (
					<LocalModelSettings currentTab={currentTab} initialModelTab={initialModelTab} setCurrentTab={setCurrentTab} />
				)}
			</Section>
		</div>
	)
}

const LocalModelSettings = ({
	initialModelTab,
	currentTab,
	setCurrentTab,
}: Pick<ApiConfigurationSectionProps, "initialModelTab"> & { currentTab: Mode; setCurrentTab: (tab: Mode) => void }) => {
	const { planActSeparateModelsSetting, mode, apiConfiguration } = useExtensionState()
	const { handleFieldsChange } = useApiConfigurationHandlers()
	return (
		<div className="flex flex-col gap-5">
			<div className="rounded-xl bg-[#151618] border border-white/[0.08] p-5">
				{planActSeparateModelsSetting ? (
					<div className="flex flex-col gap-4">
						<div className="inline-flex self-start rounded-lg bg-[#0e0f10] border border-white/[0.08] p-1 gap-1">
							<button
								className={
									currentTab === "plan"
										? "px-3 py-1 rounded-md bg-white/[0.1] text-[#f2f4f7] text-[12px] font-medium border-0 cursor-pointer"
										: "px-3 py-1 rounded-md bg-transparent text-[#858b94] hover:text-[#eceef0] text-[12px] border-0 cursor-pointer transition-colors"
								}
								onClick={() => setCurrentTab("plan")}
								type="button">
								Plan Mode
							</button>
							<button
								className={
									currentTab === "act"
										? "px-3 py-1 rounded-md bg-white/[0.1] text-[#f2f4f7] text-[12px] font-medium border-0 cursor-pointer"
										: "px-3 py-1 rounded-md bg-transparent text-[#858b94] hover:text-[#eceef0] text-[12px] border-0 cursor-pointer transition-colors"
								}
								onClick={() => setCurrentTab("act")}
								type="button">
								Act Mode
							</button>
						</div>

						<ApiOptions currentMode={currentTab} initialModelTab={initialModelTab} showModelOptions={true} />
					</div>
				) : (
					<ApiOptions currentMode={mode} initialModelTab={initialModelTab} showModelOptions={true} />
				)}
			</div>

			<div className="rounded-xl bg-[#151618] border border-white/[0.08] p-4">
				<VSCodeCheckbox
					checked={planActSeparateModelsSetting}
					onChange={async (e: any) => {
						const checked = e.target.checked === true
						try {
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
					<span className="text-[13.5px] font-medium text-[#eceef0]">
						Use different models for Plan and Act modes
					</span>
				</VSCodeCheckbox>
				<p className="text-[12px] mt-1.5 mb-0 text-[#858b94] leading-relaxed">
					Switching between Plan and Act mode will persist the API and model used in each mode (for example, a
					reasoning model to architect a plan and a fast coding model to execute).
				</p>
			</div>
		</div>
	)
}

const CloudModelSettings = () => {
	const { nextCloudModelId, cloudModelId, currentCloudTask, clinePassSubscribed } = useExtensionState()
	const { activeOrganization } = useClineAuth()
	const { isClinePassEnabled, openSubscribePage } = useClinePassPromo()
	const includeClinePass = isClinePassEnabled && !activeOrganization
	const runningModelId = currentCloudTask ? cloudModelId : undefined

	useEffect(() => {
		if (includeClinePass) {
			CloudServiceClient.refreshClinePassSubscription(EmptyRequest.create({})).catch((error) =>
				console.error("Failed to refresh ClinePass subscription:", error),
			)
		}
	}, [includeClinePass])

	return (
		<div className="rounded-xl bg-[#151618] border border-white/[0.08] p-5 flex flex-col gap-3">
			<p className="text-[12.5px] m-0 text-[#858b94] leading-relaxed">
				Cloud tasks run in an isolated sandbox on a Cline model. Usage-Billing models use Cline credits
				{includeClinePass ? ", ClinePass models use your subscription," : ""} and ClineFree models are free with limited
				usage.
			</p>
			{runningModelId && (
				<p className="text-[12px] m-0 text-[#858b94]">
					The current cloud task runs on <code className="font-geist-mono">{runningModelId}</code>.
				</p>
			)}
			<ClineModelPicker
				cloudSelection={{
					includeClinePass,
					clinePassNotice: clinePassSubscribed === false && (
						<div className="flex items-start gap-2 rounded-lg bg-[#1c1e21] border border-white/[0.08] px-3 py-2.5 mb-1.5">
							<Sparkles className="size-3.5 shrink-0 mt-0.5 text-[#cbb07a]" />
							<div className="grow text-xs text-[#9ea4ad]">
								These models need a <span className="font-medium text-[#eceef0]">ClinePass</span> subscription.{" "}
								<button
									className="cursor-pointer border-0 bg-transparent p-0 text-xs text-[#eceef0] underline"
									onClick={openSubscribePage}
									type="button">
									Subscribe
								</button>
							</div>
						</div>
					),
					modelId: nextCloudModelId ?? "",
					onChange: (modelId) =>
						CloudServiceClient.setCloudModel(StringRequest.create({ value: modelId })).catch((error) =>
							console.error("Failed to save cloud model:", error),
						),
				}}
				currentMode="act"
			/>
		</div>
	)
}

export default ApiConfigurationSection
