import { EmptyRequest, Int64Request } from "@shared/proto/index.cline"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Megaphone, Terminal } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import BannerCarousel, { BannerData } from "@/components/common/BannerCarousel"
import { CURRENT_CLI_BANNER_VERSION } from "@/components/common/CliInstallBanner"
import { CURRENT_INFO_BANNER_VERSION } from "@/components/common/InfoBanner"
import { CURRENT_MODEL_BANNER_VERSION } from "@/components/common/NewModelBanner"
import WhatsNewModal from "@/components/common/WhatsNewModal"
import HistoryPreview from "@/components/history/HistoryPreview"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import HomeHeader from "@/components/welcome/HomeHeader"
import { SuggestedTasks } from "@/components/welcome/SuggestedTasks"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient, StateServiceClient } from "@/services/grpc-client"
import { isMacOSOrLinux } from "@/utils/platformUtils"
import { WelcomeSectionProps } from "../../types/chatTypes"

/**
 * Welcome section shown when there's no active task
 * Includes info banner, announcements, home header, and history preview
 */
export const WelcomeSection: React.FC<WelcomeSectionProps> = ({
	showAnnouncement,
	hideAnnouncement,
	showHistoryView,
	version,
	taskHistory,
	shouldShowQuickWins,
}) => {
	const { lastDismissedInfoBannerVersion, lastDismissedCliBannerVersion, lastDismissedModelBannerVersion } = useExtensionState()

	// Track if we've shown the "What's New" modal this session
	const [hasShownWhatsNewModal, setHasShownWhatsNewModal] = useState(false)
	const [showWhatsNewModal, setShowWhatsNewModal] = useState(false)

	const shouldShowInfoBanner = lastDismissedInfoBannerVersion < CURRENT_INFO_BANNER_VERSION
	const shouldShowNewModelBanner = lastDismissedModelBannerVersion < CURRENT_MODEL_BANNER_VERSION

	// Show CLI banner if not dismissed and platform is VSCode (not JetBrains/standalone)
	const shouldShowCliBanner =
		isMacOSOrLinux() &&
		PLATFORM_CONFIG.type === PlatformType.VSCODE &&
		lastDismissedCliBannerVersion < CURRENT_CLI_BANNER_VERSION

	const { clineUser } = useClineAuth()
	const { openRouterModels, setShowChatModelSelector, navigateToSettings, subagentsEnabled } = useExtensionState()
	const { handleFieldsChange } = useApiConfigurationHandlers()

	// Show modal when there's a new announcement and we haven't shown it this session
	useEffect(() => {
		if (showAnnouncement && !hasShownWhatsNewModal) {
			setShowWhatsNewModal(true)
			setHasShownWhatsNewModal(true)
		}
	}, [showAnnouncement, hasShownWhatsNewModal])

	const handleCloseWhatsNewModal = useCallback(() => {
		setShowWhatsNewModal(false)
		// Call hideAnnouncement to persist dismissal (same as old banner behavior)
		hideAnnouncement()
	}, [hideAnnouncement])

	// Build array of active banners for carousel
	const activeBanners = useMemo((): BannerData[] => {
		const banners: BannerData[] = []

		if (shouldShowInfoBanner) {
			banners.push({
				id: "info-banner",
				icon: <span>💡</span>,
				title: "Use Cline in Right Sidebar",
				description: (
					<>
						For the best experience, drag the Cline icon to your right sidebar. This keeps your file explorer and
						editor visible while you chat with Cline, making it easier to navigate your codebase and see changes in
						real-time.{" "}
						<VSCodeLink
							className="cursor-pointer"
							href="https://docs.cline.bot/features/customization/opening-cline-in-sidebar"
							style={{ display: "inline" }}>
							See how →
						</VSCodeLink>
					</>
				),
				onDismiss: () => {
					StateServiceClient.updateInfoBannerVersion({ value: CURRENT_INFO_BANNER_VERSION }).catch(console.error)
				},
			})
		}

		if (shouldShowNewModelBanner) {
			const setNewModel = () => {
				const modelId = "anthropic/claude-opus-4.5"
				handleFieldsChange({
					planModeOpenRouterModelId: modelId,
					actModeOpenRouterModelId: modelId,
					planModeOpenRouterModelInfo: openRouterModels[modelId],
					actModeOpenRouterModelInfo: openRouterModels[modelId],
					planModeApiProvider: "cline",
					actModeApiProvider: "cline",
				})
				setTimeout(() => setShowChatModelSelector(true), 10)
			}

			const handleShowAccount = () => {
				AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
					console.error("Failed to get login URL:", err),
				)
			}

			banners.push({
				id: "new-model",
				icon: <Megaphone className="w-5 h-5" />,
				title: "Claude Opus 4.5 Now Available",
				description: "State-of-the-art performance at 3x lower cost than Opus 4.1. Available now in the Cline provider.",
				actions: [
					{
						label: clineUser ? "Try Now" : "Get Started",
						onClick: clineUser ? setNewModel : handleShowAccount,
						variant: "primary",
					},
				],
				onDismiss: () => {
					StateServiceClient.updateModelBannerVersion(
						Int64Request.create({ value: CURRENT_MODEL_BANNER_VERSION }),
					).catch(console.error)
				},
			})
		}

		if (shouldShowCliBanner) {
			const handleInstallCli = async () => {
				try {
					await StateServiceClient.installClineCli(EmptyRequest.create())
				} catch (error) {
					console.error("Failed to initiate CLI installation:", error)
				}
			}

			const handleEnableSubagents = () => {
				if (!subagentsEnabled) {
					navigateToSettings("features")
				}
			}

			banners.push({
				id: "cli-install",
				icon: <Terminal className="w-5 h-5" />,
				title: isMacOSOrLinux() ? "CLI & Subagents Available" : "Cline CLI Info",
				description: isMacOSOrLinux() ? (
					<>
						Use Cline in your terminal and enable subagent capabilities.{" "}
						<VSCodeLink href="https://docs.cline.bot/cline-cli/overview" style={{ display: "inline" }}>
							Learn more
						</VSCodeLink>
					</>
				) : (
					<>
						Available for macOS and Linux. Coming soon to other platforms.{" "}
						<VSCodeLink href="https://docs.cline.bot/cline-cli/overview" style={{ display: "inline" }}>
							Learn more
						</VSCodeLink>
					</>
				),
				actions: isMacOSOrLinux()
					? [
							{ label: "Install", onClick: handleInstallCli, variant: "primary" },
							{
								label: "Enable Subagents",
								onClick: handleEnableSubagents,
								variant: "primary",
								disabled: subagentsEnabled,
							},
						]
					: [
							{ label: "Install CLI", onClick: handleInstallCli, variant: "primary" },
							{ label: "Subagents (Windows coming soon)", onClick: () => {}, variant: "secondary", disabled: true },
						],
				onDismiss: () => {
					StateServiceClient.updateCliBannerVersion(Int64Request.create({ value: CURRENT_CLI_BANNER_VERSION })).catch(
						console.error,
					)
				},
			})
		}

		return banners
	}, [
		shouldShowInfoBanner,
		shouldShowNewModelBanner,
		shouldShowCliBanner,
		clineUser,
		openRouterModels,
		setShowChatModelSelector,
		handleFieldsChange,
		navigateToSettings,
		subagentsEnabled,
	])

	return (
		<div className="flex flex-col flex-1 w-full h-full p-0 m-0">
			<style>
				{`
					@keyframes fadeIn {
						from {
							opacity: 0;
							transform: scale(0.98);
						}
						to {
							opacity: 1;
							transform: scale(1);
						}
					}
					.fade-in-cards {
						animation: fadeIn 0.4s ease-out forwards;
					}
					.fade-in-history {
						animation: fadeIn 0.4s ease-out forwards;
						opacity: 0;
					}
				`}
			</style>
			<WhatsNewModal onClose={handleCloseWhatsNewModal} open={showWhatsNewModal} version={version} />
			<div className="overflow-y-auto flex flex-col pb-2.5">
				<HomeHeader shouldShowQuickWins={shouldShowQuickWins} />
				{!showWhatsNewModal && (
					<>
						<div className="fade-in-cards">
							<BannerCarousel banners={activeBanners} />
						</div>
						{!shouldShowQuickWins && taskHistory.length > 0 && (
							<div className="fade-in-history">
								<HistoryPreview showHistoryView={showHistoryView} />
							</div>
						)}
					</>
				)}
			</div>
			<SuggestedTasks shouldShowQuickWins={shouldShowQuickWins} />
		</div>
	)
}
