import { useEffect, useRef, useState } from "react"
import { VSCodeButton, VSCodeProgressRing, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { type CloudUserInfo, TelemetryEventName } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import { telemetryClient } from "@src/utils/TelemetryClient"
import { ToggleSwitch } from "@/components/ui/toggle-switch"
import { renderCloudBenefitsContent } from "./CloudUpsellDialog"
import { TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tab, TabContent, TabHeader } from "../common/Tab"
import { Button } from "@/components/ui/button"

// Define the production URL constant locally to avoid importing from cloud package in tests
const PRODUCTION_ROO_CODE_API_URL = "https://app.roocode.com"

type CloudViewProps = {
	userInfo: CloudUserInfo | null
	isAuthenticated: boolean
	cloudApiUrl?: string
	onDone: () => void
}

export const CloudView = ({ userInfo, isAuthenticated, cloudApiUrl, onDone }: CloudViewProps) => {
	const { t } = useAppTranslation()
	const {
		remoteControlEnabled,
		setRemoteControlEnabled,
		taskSyncEnabled,
		setTaskSyncEnabled,
		featureRoomoteControlEnabled,
	} = useExtensionState()
	const wasAuthenticatedRef = useRef(false)
	const timeoutRef = useRef<NodeJS.Timeout | null>(null)
	const manualUrlInputRef = useRef<HTMLInputElement | null>(null)
	// Manual URL entry state
	const [authInProgress, setAuthInProgress] = useState(false)
	const [showManualEntry, setShowManualEntry] = useState(false)
	const [manualUrl, setManualUrl] = useState("")

	// Track authentication state changes to detect successful logout
	useEffect(() => {
		if (isAuthenticated) {
			wasAuthenticatedRef.current = true
			// Clear auth in progress state when authentication succeeds
			setAuthInProgress(false)
			setShowManualEntry(false)
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
				timeoutRef.current = null
			}
		} else if (wasAuthenticatedRef.current && !isAuthenticated) {
			// User just logged out successfully
			// NOTE: Telemetry events use ACCOUNT_* naming for continuity with existing analytics
			// and to maintain historical data consistency, even though the UI now uses "Cloud" terminology
			telemetryClient.capture(TelemetryEventName.ACCOUNT_LOGOUT_SUCCESS)
			wasAuthenticatedRef.current = false
		}
	}, [isAuthenticated])

	// Focus the manual URL input when it becomes visible
	useEffect(() => {
		if (showManualEntry && manualUrlInputRef.current) {
			// Small delay to ensure the DOM is ready
			setTimeout(() => {
				manualUrlInputRef.current?.focus()
			}, 50)
		}
	}, [showManualEntry])

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
		}
	}, [])

	const handleConnectClick = () => {
		// Send telemetry for cloud connect action
		// NOTE: Using ACCOUNT_* telemetry events for backward compatibility with analytics
		telemetryClient.capture(TelemetryEventName.ACCOUNT_CONNECT_CLICKED)
		vscode.postMessage({ type: "rooCloudSignIn" })

		// Start auth in progress state - show "Having trouble?" immediately for debugging
		setAuthInProgress(true)
	}

	const handleManualUrlChange = (e: any) => {
		const url = e.target.value
		setManualUrl(url)

		// Auto-trigger authentication when a complete URL is pasted (with slight delay to ensure full paste is processed)
		setTimeout(() => {
			if (url.trim() && url.includes("://") && url.includes("/auth/clerk/callback")) {
				vscode.postMessage({ type: "rooCloudManualUrl", text: url.trim() })
			}
		}, 100)
	}

	const handleKeyDown = (e: any) => {
		if (e.key === "Enter") {
			const url = manualUrl.trim()
			if (url && url.includes("://") && url.includes("/auth/clerk/callback")) {
				vscode.postMessage({ type: "rooCloudManualUrl", text: url })
			}
		}
	}

	const handleShowManualEntry = () => {
		setShowManualEntry(true)
	}

	const handleReset = () => {
		setAuthInProgress(false)
		setShowManualEntry(false)
		setManualUrl("")
	}

	const handleLogoutClick = () => {
		// Send telemetry for cloud logout action
		// NOTE: Using ACCOUNT_* telemetry events for backward compatibility with analytics
		telemetryClient.capture(TelemetryEventName.ACCOUNT_LOGOUT_CLICKED)
		vscode.postMessage({ type: "rooCloudSignOut" })
	}

	const handleVisitCloudWebsite = () => {
		// Send telemetry for cloud website visit
		// NOTE: Using ACCOUNT_* telemetry events for backward compatibility with analytics
		telemetryClient.capture(TelemetryEventName.ACCOUNT_CONNECT_CLICKED)
		const cloudUrl = cloudApiUrl || PRODUCTION_ROO_CODE_API_URL
		vscode.postMessage({ type: "openExternal", url: cloudUrl })
	}

	const handleOpenCloudUrl = () => {
		if (cloudApiUrl) {
			vscode.postMessage({ type: "openExternal", url: cloudApiUrl })
		}
	}

	const handleRemoteControlToggle = () => {
		const newValue = !remoteControlEnabled
		setRemoteControlEnabled(newValue)
		vscode.postMessage({ type: "remoteControlEnabled", bool: newValue })
	}

	const handleTaskSyncToggle = () => {
		const newValue = !taskSyncEnabled
		setTaskSyncEnabled(newValue)
		vscode.postMessage({ type: "taskSyncEnabled", bool: newValue })
	}

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center">
				<h3 className="text-vscode-foreground m-0">{isAuthenticated && t("cloud:title")}</h3>
				<Button onClick={onDone}>{t("settings:common.done")}</Button>
			</TabHeader>

			<TabContent>
				{isAuthenticated ? (
					<>
						{userInfo && (
							<div className="flex flex-col items-center mb-6">
								<div className="w-16 h-16 mb-3 rounded-full overflow-hidden">
									{userInfo?.picture ? (
										<img
											src={userInfo.picture}
											alt={t("cloud:profilePicture")}
											className="w-full h-full object-cover"
										/>
									) : (
										<div className="w-full h-full flex items-center justify-center bg-vscode-button-background text-vscode-button-foreground text-xl">
											{userInfo?.name?.charAt(0) || userInfo?.email?.charAt(0) || "?"}
										</div>
									)}
								</div>
								{userInfo.name && (
									<h2 className="text-lg font-medium text-vscode-foreground my-0">{userInfo.name}</h2>
								)}
								{userInfo?.email && (
									<p className="text-sm text-vscode-descriptionForeground my-0">{userInfo?.email}</p>
								)}
								{userInfo?.organizationName && (
									<div className="flex items-center gap-2 text-sm text-vscode-descriptionForeground mt-2">
										{userInfo.organizationImageUrl && (
											<img
												src={userInfo.organizationImageUrl}
												alt={userInfo.organizationName}
												className="w-4 h-4 rounded object-cover"
											/>
										)}
										<span>{userInfo.organizationName}</span>
									</div>
								)}
							</div>
						)}

						{/* Task Sync Toggle - Always shown when authenticated */}
						<div className="border-t border-vscode-widget-border pt-4 mt-4">
							<div className="flex items-center gap-3 mb-2">
								<ToggleSwitch
									checked={taskSyncEnabled}
									onChange={handleTaskSyncToggle}
									size="medium"
									aria-label={t("cloud:taskSync")}
									data-testid="task-sync-toggle"
									disabled={!!userInfo?.organizationId}
								/>
								<span className="font-medium text-vscode-foreground">{t("cloud:taskSync")}</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1 mb-4 ml-8">
								{t("cloud:taskSyncDescription")}
							</div>
							{userInfo?.organizationId && (
								<div className="text-vscode-descriptionForeground text-sm mt-1 mb-4 ml-8 italic">
									{t("cloud:taskSyncManagedByOrganization")}
								</div>
							)}

							{/* Remote Control Toggle - Only shown when both extensionBridgeEnabled and featureRoomoteControlEnabled are true */}
							{userInfo?.extensionBridgeEnabled && featureRoomoteControlEnabled && (
								<>
									<div className="flex items-center gap-3 mb-2">
										<ToggleSwitch
											checked={remoteControlEnabled}
											onChange={handleRemoteControlToggle}
											size="medium"
											aria-label={t("cloud:remoteControl")}
											data-testid="remote-control-toggle"
											disabled={!taskSyncEnabled}
										/>
										<span className="font-medium text-vscode-foreground">
											{t("cloud:remoteControl")}
										</span>
									</div>
									<div className="text-vscode-descriptionForeground text-sm mt-1 mb-4 ml-8">
										{t("cloud:remoteControlDescription")}
										{!taskSyncEnabled && (
											<div className="text-vscode-errorForeground mt-2">
												{t("cloud:remoteControlRequiresTaskSync")}
											</div>
										)}
									</div>
								</>
							)}

							{/* Info text about usage metrics */}
							<div className="text-vscode-descriptionForeground text-sm mt-4 mb-4 ml-8 italic">
								{t("cloud:usageMetricsAlwaysReported")}
							</div>

							<hr className="border-vscode-widget-border mb-4" />
						</div>

						<div className="flex flex-col gap-2 mt-4">
							<VSCodeButton appearance="secondary" onClick={handleVisitCloudWebsite} className="w-full">
								{t("cloud:visitCloudWebsite")}
							</VSCodeButton>
							<VSCodeButton appearance="secondary" onClick={handleLogoutClick} className="w-full">
								{t("cloud:logOut")}
							</VSCodeButton>
						</div>
					</>
				) : (
					<>
						<div className="flex flex-col items-start gap-4 px-8">
							<div className={cn(authInProgress && "opacity-50")}>{renderCloudBenefitsContent(t)}</div>

							{!authInProgress && (
								<VSCodeButton appearance="primary" onClick={handleConnectClick} className="w-full">
									{t("cloud:connect")}
								</VSCodeButton>
							)}

							{/* Manual entry section */}
							{authInProgress && !showManualEntry && (
								// Timeout message with "Having trouble?" link
								<div className="flex flex-col items-start gap-1">
									<div className="flex items-center gap-2 text-base text-vscode-descriptionForeground">
										<VSCodeProgressRing className="size-3 text-vscode-foreground" />
										{t("cloud:authWaiting")}
									</div>
									{!showManualEntry && (
										<button
											onClick={handleShowManualEntry}
											className="text-base ml-5 text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline cursor-pointer bg-transparent border-none p-0">
											{t("cloud:havingTrouble")}
										</button>
									)}
								</div>
							)}

							{showManualEntry && (
								// Manual URL entry form
								<div className="space-y-2 max-w-72">
									<p className="text-base text-vscode-descriptionForeground">
										{t("cloud:pasteCallbackUrl")}
									</p>
									<VSCodeTextField
										ref={manualUrlInputRef as any}
										value={manualUrl}
										onChange={handleManualUrlChange}
										onKeyDown={handleKeyDown}
										placeholder="vscode://RooVeterinaryInc.roo-cline/auth/clerk/callback?state=..."
										className="w-full"
									/>
									<p className="mt-1">
										or{" "}
										<button
											onClick={handleReset}
											className="text-base text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline cursor-pointer bg-transparent border-none p-0">
											{t("cloud:startOver")}
										</button>
									</p>
								</div>
							)}
						</div>
					</>
				)}
				{cloudApiUrl && cloudApiUrl !== PRODUCTION_ROO_CODE_API_URL && (
					<div className="ml-8 mt-6 flex justify-start">
						<div className="inline-flex items-center gap-2 text-xs">
							<TriangleAlert className="size-4 text-vscode-descriptionForeground" />
							<span className="text-vscode-foreground/75">{t("cloud:cloudUrlPillLabel")}: </span>
							<button
								onClick={handleOpenCloudUrl}
								className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline cursor-pointer bg-transparent border-none p-0">
								{cloudApiUrl}
							</button>
						</div>
					</div>
				)}
			</TabContent>
		</Tab>
	)
}
