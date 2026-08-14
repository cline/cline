import type { ApiConfiguration, NamedApiBackend } from "@shared/api"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { TabButton } from "../../mcp/configuration/McpConfigurationView"
import ApiOptions from "../ApiOptions"
import Section from "../Section"
import { syncModeConfigurations } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import NamedBackendsSection from "./NamedBackendsSection"

interface ApiConfigurationSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
	initialModelTab?: "recommended" | "free"
}

interface EditingBackendSession {
	/** The backend's name before this edit started; null when adding a brand new backend. */
	originalName: string | null
	name: string
	priorConfig: ApiConfiguration
	priorDefaultBackendName: string
}

const ApiConfigurationSection = ({ renderSectionHeader, initialModelTab }: ApiConfigurationSectionProps) => {
	const { planActSeparateModelsSetting, mode, apiConfiguration, defaultBackendName, namedApiBackends } = useExtensionState()
	const [currentTab, setCurrentTab] = useState<Mode>(mode)
	const { handleFieldsChange } = useApiConfigurationHandlers()
	const [editingBackend, setEditingBackend] = useState<EditingBackendSession | undefined>(undefined)

	const applyLiveConfig = async (config: ApiConfiguration, backendName: string) => {
		await StateServiceClient.updateSettings(
			UpdateSettingsRequest.create({
				apiConfiguration: convertApiConfigurationToProto(config),
				defaultBackendName: backendName,
			}),
		)
	}

	const handleStartEditBackend = async (name: string | null) => {
		const session: EditingBackendSession = {
			originalName: name,
			name: name ?? "",
			priorConfig: apiConfiguration ?? {},
			priorDefaultBackendName: defaultBackendName ?? "",
		}
		setEditingBackend(session)
		if (name) {
			const target = (namedApiBackends ?? []).find((backend) => backend.name === name)
			if (target) {
				await applyLiveConfig(target.config, name)
			}
		}
		// Adding new: leave the live config as-is, used as the starting template.
	}

	const handleCancelEditBackend = async () => {
		if (!editingBackend) {
			return
		}
		await applyLiveConfig(editingBackend.priorConfig, editingBackend.priorDefaultBackendName)
		setEditingBackend(undefined)
	}

	const handleSaveEditBackend = async () => {
		if (!editingBackend) {
			return
		}
		const trimmedName = editingBackend.name.trim()
		if (!trimmedName) {
			return
		}
		const backends = namedApiBackends ?? []
		const collides = backends.some((backend) => backend.name === trimmedName && backend.name !== editingBackend.originalName)
		if (collides || trimmedName === editingBackend.priorDefaultBackendName) {
			return
		}
		const newEntry: NamedApiBackend = { name: trimmedName, config: apiConfiguration ?? {} }
		const updated =
			editingBackend.originalName !== null
				? backends.map((backend) => (backend.name === editingBackend.originalName ? newEntry : backend))
				: [...backends, newEntry]

		await StateServiceClient.updateSettings(UpdateSettingsRequest.create({ namedApiBackendsJson: JSON.stringify(updated) }))
		await applyLiveConfig(editingBackend.priorConfig, editingBackend.priorDefaultBackendName)
		setEditingBackend(undefined)
	}

	const handleDeleteBackend = async (name: string) => {
		const updated = (namedApiBackends ?? []).filter((backend) => backend.name !== name)
		await StateServiceClient.updateSettings(UpdateSettingsRequest.create({ namedApiBackendsJson: JSON.stringify(updated) }))
	}

	const handleSwitchToBackend = async (backend: NamedApiBackend) => {
		await applyLiveConfig(backend.config, backend.name)
	}

	return (
		<div>
			{renderSectionHeader?.("api-config")}
			<Section>
				{editingBackend && (
					<div className="mb-3 p-[10px] rounded-md border border-solid border-(--vscode-focusBorder)">
						<p className="text-xs mt-0 mb-[8px]">
							{editingBackend.originalName
								? `Editing backend "${editingBackend.originalName}"`
								: "Adding a new backend"}{" "}
							— the configuration below previews as your active setup while editing. Save to store it under this
							name, or Cancel to restore your actual default ({editingBackend.priorDefaultBackendName || "unnamed"}
							).
						</p>
						<VSCodeTextField
							className="w-full mb-[8px]"
							onInput={(e: any) => setEditingBackend({ ...editingBackend, name: e.target.value })}
							placeholder="e.g. Claude Opus"
							value={editingBackend.name}>
							Backend name
						</VSCodeTextField>
						<div className="flex gap-1">
							<VSCodeButton disabled={!editingBackend.name.trim()} onClick={handleSaveEditBackend}>
								Save
							</VSCodeButton>
							<VSCodeButton appearance="secondary" onClick={handleCancelEditBackend}>
								Cancel
							</VSCodeButton>
						</div>
					</div>
				)}

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

				<NamedBackendsSection
					isEditing={!!editingBackend}
					onDelete={handleDeleteBackend}
					onStartEdit={handleStartEditBackend}
					onSwitchTo={handleSwitchToBackend}
				/>
			</Section>
		</div>
	)
}

export default ApiConfigurationSection
