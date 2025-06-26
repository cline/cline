import { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

import type { HistoryItem, ShareVisibility } from "@roo-code/types"
import { TelemetryEventName } from "@roo-code/types"

import { vscode } from "@/utils/vscode"
import { telemetryClient } from "@/utils/TelemetryClient"
import { useExtensionState } from "@/context/ExtensionStateContext"
import {
	Button,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Command,
	CommandList,
	CommandItem,
	CommandGroup,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	StandardTooltip,
} from "@/components/ui"

interface ShareButtonProps {
	item?: HistoryItem
	disabled?: boolean
}

export const ShareButton = ({ item, disabled = false }: ShareButtonProps) => {
	const [shareDropdownOpen, setShareDropdownOpen] = useState(false)
	const [connectModalOpen, setConnectModalOpen] = useState(false)
	const [shareSuccess, setShareSuccess] = useState<{ visibility: ShareVisibility; url: string } | null>(null)
	const { t } = useTranslation()
	const { sharingEnabled, cloudIsAuthenticated, cloudUserInfo } = useExtensionState()
	const wasUnauthenticatedRef = useRef(false)

	// Track authentication state changes to auto-open popover after login
	useEffect(() => {
		if (!cloudIsAuthenticated || !sharingEnabled) {
			wasUnauthenticatedRef.current = true
		} else if (wasUnauthenticatedRef.current && cloudIsAuthenticated && sharingEnabled) {
			// User just authenticated, send telemetry, close modal, and open the popover
			telemetryClient.capture(TelemetryEventName.ACCOUNT_CONNECT_SUCCESS)
			setConnectModalOpen(false)
			setShareDropdownOpen(true)
			wasUnauthenticatedRef.current = false
		}
	}, [cloudIsAuthenticated, sharingEnabled])

	// Listen for share success messages from the extension
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "shareTaskSuccess") {
				setShareSuccess({
					visibility: message.visibility,
					url: message.text,
				})
				// Auto-hide success message and close popover after 5 seconds
				setTimeout(() => {
					setShareSuccess(null)
					setShareDropdownOpen(false)
				}, 5000)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleShare = (visibility: ShareVisibility) => {
		// Clear any previous success state
		setShareSuccess(null)

		// Send telemetry for share action
		if (visibility === "organization") {
			telemetryClient.capture(TelemetryEventName.SHARE_ORGANIZATION_CLICKED)
		} else {
			telemetryClient.capture(TelemetryEventName.SHARE_PUBLIC_CLICKED)
		}

		vscode.postMessage({
			type: "shareCurrentTask",
			visibility,
		})
		// Don't close the dropdown immediately - let success message show first
	}

	const handleConnectToCloud = () => {
		// Send telemetry for connect to cloud action
		telemetryClient.capture(TelemetryEventName.SHARE_CONNECT_TO_CLOUD_CLICKED)

		vscode.postMessage({ type: "rooCloudSignIn" })
		setShareDropdownOpen(false)
		setConnectModalOpen(false)
	}

	const handleShareButtonClick = () => {
		// Send telemetry for share button click
		telemetryClient.capture(TelemetryEventName.SHARE_BUTTON_CLICKED)

		if (!cloudIsAuthenticated) {
			// Show modal for unauthenticated users
			setConnectModalOpen(true)
		} else {
			// Show popover for authenticated users
			setShareDropdownOpen(true)
		}
	}

	// Determine share button state
	const getShareButtonState = () => {
		if (!cloudIsAuthenticated) {
			return {
				disabled: false,
				title: t("chat:task.share"),
				showPopover: false, // We'll show modal instead
			}
		} else if (!sharingEnabled) {
			return {
				disabled: true,
				title: t("chat:task.sharingDisabledByOrganization"),
				showPopover: false,
			}
		} else {
			return {
				disabled: false,
				title: t("chat:task.share"),
				showPopover: true,
			}
		}
	}

	const shareButtonState = getShareButtonState()

	// Don't render if no item ID
	if (!item?.id) {
		return null
	}

	return (
		<>
			{shareButtonState.showPopover ? (
				<Popover open={shareDropdownOpen} onOpenChange={setShareDropdownOpen}>
					<PopoverTrigger asChild>
						<StandardTooltip content={shareButtonState.title}>
							<Button
								variant="ghost"
								size="icon"
								disabled={disabled || shareButtonState.disabled}
								className="h-7 w-7 p-1.5 hover:bg-vscode-toolbar-hoverBackground"
								onClick={handleShareButtonClick}>
								<span className="codicon codicon-link"></span>
							</Button>
						</StandardTooltip>
					</PopoverTrigger>
					<PopoverContent className="w-56 p-0" align="start">
						{shareSuccess ? (
							<div className="p-3">
								<div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
									<span className="codicon codicon-check"></span>
									<span>
										{shareSuccess.visibility === "public"
											? t("chat:task.shareSuccessPublic")
											: t("chat:task.shareSuccessOrganization")}
									</span>
								</div>
							</div>
						) : (
							<Command>
								<CommandList>
									<CommandGroup>
										{cloudUserInfo?.organizationName && (
											<CommandItem
												onSelect={() => handleShare("organization")}
												className="cursor-pointer">
												<div className="flex items-center gap-2">
													<span className="codicon codicon-organization text-sm"></span>
													<div className="flex flex-col">
														<span className="text-sm">
															{t("chat:task.shareWithOrganization")}
														</span>
														<span className="text-xs text-vscode-descriptionForeground">
															{t("chat:task.shareWithOrganizationDescription")}
														</span>
													</div>
												</div>
											</CommandItem>
										)}
										<CommandItem onSelect={() => handleShare("public")} className="cursor-pointer">
											<div className="flex items-center gap-2">
												<span className="codicon codicon-globe text-sm"></span>
												<div className="flex flex-col">
													<span className="text-sm">{t("chat:task.sharePublicly")}</span>
													<span className="text-xs text-vscode-descriptionForeground">
														{t("chat:task.sharePubliclyDescription")}
													</span>
												</div>
											</div>
										</CommandItem>
									</CommandGroup>
								</CommandList>
							</Command>
						)}
					</PopoverContent>
				</Popover>
			) : (
				<StandardTooltip content={shareButtonState.title}>
					<Button
						variant="ghost"
						size="icon"
						disabled={disabled || shareButtonState.disabled}
						className="h-7 w-7 p-1.5 hover:bg-vscode-toolbar-hoverBackground"
						onClick={handleShareButtonClick}>
						<span className="codicon codicon-link"></span>
					</Button>
				</StandardTooltip>
			)}

			{/* Connect to Cloud Modal */}
			<Dialog open={connectModalOpen} onOpenChange={setConnectModalOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader className="text-center">
						<DialogTitle className="text-lg font-medium text-vscode-foreground">
							{t("account:cloudBenefitsTitle")}
						</DialogTitle>
					</DialogHeader>

					<div className="flex flex-col space-y-6">
						<div>
							<p className="text-md text-vscode-descriptionForeground mb-4">
								{t("account:cloudBenefitsSubtitle")}
							</p>
							<ul className="text-sm text-vscode-descriptionForeground space-y-2">
								<li className="flex items-start">
									<span className="mr-2 text-vscode-foreground">•</span>
									{t("account:cloudBenefitSharing")}
								</li>
								<li className="flex items-start">
									<span className="mr-2 text-vscode-foreground">•</span>
									{t("account:cloudBenefitHistory")}
								</li>
								<li className="flex items-start">
									<span className="mr-2 text-vscode-foreground">•</span>
									{t("account:cloudBenefitMetrics")}
								</li>
							</ul>
						</div>

						<div className="flex flex-col gap-4">
							<Button onClick={handleConnectToCloud} className="w-full">
								{t("account:connect")}
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
