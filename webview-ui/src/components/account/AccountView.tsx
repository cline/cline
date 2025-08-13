import { useEffect, useRef } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { TelemetryEventName } from "@roo-code/types"

import type { CloudUserInfo } from "@roo/cloud"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import { telemetryClient } from "@src/utils/TelemetryClient"
import { ToggleSwitch } from "@/components/ui/toggle-switch"

import { History, PiggyBank, SquareArrowOutUpRightIcon } from "lucide-react"

type AccountViewProps = {
	userInfo: CloudUserInfo | null
	isAuthenticated: boolean
	cloudApiUrl?: string
	onDone: () => void
}

export const AccountView = ({ userInfo, isAuthenticated, cloudApiUrl, onDone }: AccountViewProps) => {
	const { t } = useAppTranslation()
	const { remoteControlEnabled, setRemoteControlEnabled } = useExtensionState()
	const wasAuthenticatedRef = useRef(false)

	const rooLogoUri = (window as any).IMAGES_BASE_URI + "/roo-logo.svg"

	// Track authentication state changes to detect successful logout
	useEffect(() => {
		if (isAuthenticated) {
			wasAuthenticatedRef.current = true
		} else if (wasAuthenticatedRef.current && !isAuthenticated) {
			// User just logged out successfully
			telemetryClient.capture(TelemetryEventName.ACCOUNT_LOGOUT_SUCCESS)
			wasAuthenticatedRef.current = false
		}
	}, [isAuthenticated])

	const handleConnectClick = () => {
		// Send telemetry for account connect action
		telemetryClient.capture(TelemetryEventName.ACCOUNT_CONNECT_CLICKED)
		vscode.postMessage({ type: "rooCloudSignIn" })
	}

	const handleLogoutClick = () => {
		// Send telemetry for account logout action
		telemetryClient.capture(TelemetryEventName.ACCOUNT_LOGOUT_CLICKED)
		vscode.postMessage({ type: "rooCloudSignOut" })
	}

	const handleVisitCloudWebsite = () => {
		// Send telemetry for cloud website visit
		telemetryClient.capture(TelemetryEventName.ACCOUNT_CONNECT_CLICKED)
		const cloudUrl = cloudApiUrl || "https://app.roocode.com"
		vscode.postMessage({ type: "openExternal", url: cloudUrl })
	}

	const handleRemoteControlToggle = () => {
		const newValue = !remoteControlEnabled
		setRemoteControlEnabled(newValue)
		vscode.postMessage({ type: "remoteControlEnabled", bool: newValue })
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex justify-between items-center mb-6">
				<h1 className="text-xl font-medium text-vscode-foreground">{t("account:title")}</h1>
				<VSCodeButton appearance="secondary" onClick={onDone}>
					{t("settings:common.done")}
				</VSCodeButton>
			</div>
			{isAuthenticated ? (
				<>
					{userInfo && (
						<div className="flex flex-col items-center mb-6">
							<div className="w-16 h-16 mb-3 rounded-full overflow-hidden">
								{userInfo?.picture ? (
									<img
										src={userInfo.picture}
										alt={t("account:profilePicture")}
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

					{userInfo?.extensionBridgeEnabled && (
						<div className="border-t border-vscode-widget-border pt-4 mt-4">
							<div className="flex items-center gap-3 mb-2">
								<ToggleSwitch
									checked={remoteControlEnabled}
									onChange={handleRemoteControlToggle}
									size="medium"
									aria-label={t("account:remoteControl")}
									data-testid="remote-control-toggle"
								/>
								<span className="font-medium text-vscode-foreground">{t("account:remoteControl")}</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1 mb-4 ml-8">
								{t("account:remoteControlDescription")}
							</div>
							<hr className="border-vscode-widget-border mb-4" />
						</div>
					)}

					<div className="flex flex-col gap-2 mt-4">
						<VSCodeButton appearance="secondary" onClick={handleVisitCloudWebsite} className="w-full">
							{t("account:visitCloudWebsite")}
						</VSCodeButton>
						<VSCodeButton appearance="secondary" onClick={handleLogoutClick} className="w-full">
							{t("account:logOut")}
						</VSCodeButton>
					</div>
				</>
			) : (
				<>
					<div className="flex flex-col items-center mb-1 text-center">
						<div className="w-16 h-16 mb-1 flex items-center justify-center">
							<div
								className="w-12 h-12 bg-vscode-foreground"
								style={{
									WebkitMaskImage: `url('${rooLogoUri}')`,
									WebkitMaskRepeat: "no-repeat",
									WebkitMaskSize: "contain",
									maskImage: `url('${rooLogoUri}')`,
									maskRepeat: "no-repeat",
									maskSize: "contain",
								}}>
								<img src={rooLogoUri} alt="Roo logo" className="w-12 h-12 opacity-0" />
							</div>
						</div>
					</div>

					<div className="flex flex-col mb-6 text-center">
						<h2 className="text-xl font-bold text-vscode-foreground mb-2">
							{t("account:cloudBenefitsTitle")}
						</h2>
						<ul className="text-vscode-descriptionForeground space-y-3 mx-auto px-8">
							<li className="flex items-start text-left gap-4">
								<SquareArrowOutUpRightIcon size="16" className="shrink-0" />
								{t("account:cloudBenefitSharing")}
							</li>
							<li className="flex items-start text-left gap-4">
								<History size="16" className="shrink-0" />
								{t("account:cloudBenefitHistory")}
							</li>
							<li className="flex items-start text-left gap-4">
								<PiggyBank size="16" className="shrink-0" />
								{t("account:cloudBenefitMetrics")}
							</li>
						</ul>
					</div>

					<div className="flex flex-col items-center gap-4">
						<VSCodeButton appearance="primary" onClick={handleConnectClick} className="w-1/2">
							{t("account:connect")}
						</VSCodeButton>
					</div>
				</>
			)}
		</div>
	)
}
