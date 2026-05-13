import { MAX_API_CONFIGURATION_PROFILES } from "@shared/api-configuration-profiles"
import { StringRequest } from "@shared/proto/cline/common"
import { SaveApiConfigurationProfileRequest } from "@shared/proto/cline/models"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { type LucideIcon, Plus, Save, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient, StateServiceClient } from "@/services/grpc-client"
import { TabButton } from "../../mcp/configuration/McpConfigurationView"
import ApiOptions from "../ApiOptions"
import Section from "../Section"
import { syncModeConfigurations } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ApiConfigurationSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
	initialModelTab?: "recommended" | "free"
}

const ApiConfigurationSection = ({ renderSectionHeader, initialModelTab }: ApiConfigurationSectionProps) => {
	const {
		planActSeparateModelsSetting,
		mode,
		apiConfiguration,
		apiConfigurationProfiles = [],
		activeApiConfigurationProfileId,
	} = useExtensionState()
	const [currentTab, setCurrentTab] = useState<Mode>(mode)
	const [profileName, setProfileName] = useState("")
	const [profileError, setProfileError] = useState<string | undefined>()
	const [isProfileBusy, setIsProfileBusy] = useState(false)
	const { handleFieldsChange } = useApiConfigurationHandlers()
	const activeProfile = useMemo(
		() => apiConfigurationProfiles.find((profile) => profile.id === activeApiConfigurationProfileId),
		[activeApiConfigurationProfileId, apiConfigurationProfiles],
	)

	useEffect(() => {
		setProfileName(activeProfile?.name ?? "")
		setProfileError(undefined)
	}, [activeProfile?.id, activeProfile?.name])

	const saveProfile = async (saveAsNew = false) => {
		const name = profileName.trim()
		if (!name) {
			setProfileError("Profile name is required.")
			return
		}
		const matchingProfile = apiConfigurationProfiles.find(
			(profile) => profile.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
		)
		if (matchingProfile && (saveAsNew || matchingProfile.id !== activeApiConfigurationProfileId)) {
			setProfileError("A profile with this name already exists.")
			return
		}
		if (saveAsNew && apiConfigurationProfiles.length >= MAX_API_CONFIGURATION_PROFILES) {
			setProfileError(`You can save up to ${MAX_API_CONFIGURATION_PROFILES} profiles.`)
			return
		}

		try {
			setIsProfileBusy(true)
			setProfileError(undefined)
			await ModelsServiceClient.saveApiConfigurationProfile(
				SaveApiConfigurationProfileRequest.create({
					id: saveAsNew ? undefined : activeApiConfigurationProfileId,
					name,
				}),
			)
		} catch (error) {
			setProfileError("Failed to save profile.")
			console.error("Failed to save API configuration profile:", error)
		} finally {
			setIsProfileBusy(false)
		}
	}

	const loadProfile = async (profileId: string) => {
		if (!profileId || profileId === activeApiConfigurationProfileId) {
			return
		}

		try {
			setIsProfileBusy(true)
			setProfileError(undefined)
			await ModelsServiceClient.loadApiConfigurationProfile(StringRequest.create({ value: profileId }))
		} catch (error) {
			setProfileError("Failed to load profile.")
			console.error("Failed to load API configuration profile:", error)
		} finally {
			setIsProfileBusy(false)
		}
	}

	const deleteProfile = async () => {
		if (!activeApiConfigurationProfileId) {
			return
		}

		const confirmed = window.confirm(`Delete profile "${activeProfile?.name ?? "Untitled"}"?`)
		if (!confirmed) {
			return
		}

		try {
			setIsProfileBusy(true)
			setProfileError(undefined)
			await ModelsServiceClient.deleteApiConfigurationProfile(
				StringRequest.create({ value: activeApiConfigurationProfileId }),
			)
		} catch (error) {
			setProfileError("Failed to delete profile.")
			console.error("Failed to delete API configuration profile:", error)
		} finally {
			setIsProfileBusy(false)
		}
	}

	const renderProfileButton = ({
		Icon,
		label,
		disabled,
		minWidth,
		onClick,
	}: {
		Icon: LucideIcon
		label: string
		disabled?: boolean
		minWidth: number
		onClick: () => void
	}) => (
		<button
			className="box-border inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-[2px] border border-solid px-3 text-sm leading-none"
			disabled={disabled}
			onClick={onClick}
			style={{
				backgroundColor: "var(--vscode-button-secondaryBackground, var(--vscode-button-background))",
				borderColor: "var(--vscode-button-border, transparent)",
				color: disabled
					? "var(--vscode-disabledForeground)"
					: "var(--vscode-button-secondaryForeground, var(--vscode-button-foreground))",
				cursor: disabled ? "not-allowed" : "pointer",
				minWidth,
				opacity: disabled ? 0.5 : 1,
			}}
			type="button">
			<Icon aria-hidden="true" size={14} strokeWidth={2} style={{ flexShrink: 0 }} />
			<span className="whitespace-nowrap">{label}</span>
		</button>
	)

	return (
		<div>
			{renderSectionHeader?.("api-config")}
			<Section>
				<div className="flex flex-col gap-2 pb-3 border-0 border-b border-solid border-(--vscode-panel-border)">
					<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
						<div>
							<div className="mb-1 font-medium">Profile</div>
							<VSCodeDropdown
								disabled={isProfileBusy || apiConfigurationProfiles.length === 0}
								onChange={(e: any) => loadProfile(e.target.value)}
								style={{ width: "100%" }}
								value={activeApiConfigurationProfileId ?? ""}>
								<VSCodeOption value="">Current settings</VSCodeOption>
								{apiConfigurationProfiles.map((profile) => (
									<VSCodeOption key={profile.id} value={profile.id}>
										{profile.name}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
						</div>
						<div>
							<div className="mb-1 font-medium">Profile name</div>
							<VSCodeTextField
								disabled={isProfileBusy}
								onInput={(e: any) => setProfileName(e.target.value)}
								placeholder="Work, personal, local..."
								style={{ width: "100%" }}
								value={profileName}
							/>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{renderProfileButton({
							Icon: Save,
							disabled: isProfileBusy,
							label: "Save",
							minWidth: 82,
							onClick: () => saveProfile(false),
						})}
						{renderProfileButton({
							Icon: Plus,
							disabled: isProfileBusy || apiConfigurationProfiles.length >= MAX_API_CONFIGURATION_PROFILES,
							label: "Save as New",
							minWidth: 132,
							onClick: () => saveProfile(true),
						})}
						{renderProfileButton({
							Icon: Trash2,
							disabled: isProfileBusy || !activeApiConfigurationProfileId,
							label: "Delete",
							minWidth: 94,
							onClick: deleteProfile,
						})}
						{profileError && <span className="text-xs text-(--vscode-errorForeground)">{profileError}</span>}
					</div>
				</div>

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
			</Section>
		</div>
	)
}

export default ApiConfigurationSection
