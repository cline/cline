import { BANNER_DATA, BannerAction, BannerActionType, BannerCardData } from "@shared/cline/banner"
import { EmptyRequest, Int64Request } from "@shared/proto/index.cline"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import BannerCarousel from "@/components/common/BannerCarousel"
import { CURRENT_CLI_BANNER_VERSION } from "@/components/common/CliInstallBanner"
import { CURRENT_INFO_BANNER_VERSION } from "@/components/common/InfoBanner"
import { CURRENT_MODEL_BANNER_VERSION } from "@/components/common/NewModelBanner"
import WhatsNewModal from "@/components/common/WhatsNewModal"
import HistoryPreview from "@/components/history/HistoryPreview"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import HomeHeader from "@/components/welcome/HomeHeader"
import { SuggestedTasks } from "@/components/welcome/SuggestedTasks"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient, StateServiceClient } from "@/services/grpc-client"
import { convertBannerData } from "@/utils/bannerUtils"
import { getCurrentPlatform } from "@/utils/platformUtils"
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

	/**
	 * Check if a banner has been dismissed based on its version
	 */
	const isBannerDismissed = useCallback(
		(bannerId: string): boolean => {
			if (bannerId.startsWith("info-banner")) {
				return (lastDismissedInfoBannerVersion ?? 0) >= CURRENT_INFO_BANNER_VERSION
			}
			if (bannerId.startsWith("new-model")) {
				return (lastDismissedModelBannerVersion ?? 0) >= CURRENT_MODEL_BANNER_VERSION
			}
			if (bannerId.startsWith("cli-")) {
				return (lastDismissedCliBannerVersion ?? 0) >= CURRENT_CLI_BANNER_VERSION
			}
			return false
		},
		[lastDismissedInfoBannerVersion, lastDismissedModelBannerVersion, lastDismissedCliBannerVersion],
	)

	/**
	 * Banner configuration from backend
	 * In production, this would come from an API/gRPC call
	 * For now, using EXAMPLE_BANNER_DATA with version-based filtering
	 */
	const bannerConfig = useMemo((): BannerCardData[] => {
		// Filter banners based on version tracking and user status
		return BANNER_DATA.filter((banner) => {
			if (isBannerDismissed(banner.id)) {
				return false
			}

			if (banner.isClineUserOnly !== undefined) {
				return banner.isClineUserOnly === !!clineUser
			}

			if (banner.platforms && !banner.platforms.includes(getCurrentPlatform())) {
				return false
			}

			return true
		})
	}, [isBannerDismissed, clineUser])

	/**
	 * Action handler - maps action types to actual implementations
	 */
	const handleBannerAction = useCallback(
		(action: BannerAction) => {
			switch (action.action) {
				case BannerActionType.Link:
					// Links are handled by VSCodeLink component
					break

				case BannerActionType.SetModel: {
					const modelId = action.arg || "anthropic/claude-opus-4.5"
					handleFieldsChange({
						planModeOpenRouterModelId: modelId,
						actModeOpenRouterModelId: modelId,
						planModeOpenRouterModelInfo: openRouterModels[modelId],
						actModeOpenRouterModelInfo: openRouterModels[modelId],
						planModeApiProvider: "cline",
						actModeApiProvider: "cline",
					})
					setTimeout(() => setShowChatModelSelector(true), 10)
					break
				}

				case BannerActionType.ShowAccount:
					AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
						console.error("Failed to get login URL:", err),
					)
					break

				case BannerActionType.ShowApiSettings:
					navigateToSettings("api")
					break

				case BannerActionType.ShowFeatureSettings:
					navigateToSettings("features")
					break

				case BannerActionType.InstallCli:
					StateServiceClient.installClineCli(EmptyRequest.create()).catch((error) =>
						console.error("Failed to initiate CLI installation:", error),
					)
					break

				default:
					console.warn("Unknown banner action:", action.action)
			}
		},
		[handleFieldsChange, openRouterModels, setShowChatModelSelector, navigateToSettings],
	)

	/**
	 * Dismissal handler - updates version tracking
	 */
	const handleBannerDismiss = useCallback((bannerId: string) => {
		// Map banner IDs to version updates
		if (bannerId.startsWith("info-banner")) {
			StateServiceClient.updateInfoBannerVersion({ value: CURRENT_INFO_BANNER_VERSION }).catch(console.error)
		} else if (bannerId.startsWith("new-model")) {
			StateServiceClient.updateModelBannerVersion(Int64Request.create({ value: CURRENT_MODEL_BANNER_VERSION })).catch(
				console.error,
			)
		} else if (bannerId.startsWith("cli-")) {
			StateServiceClient.updateCliBannerVersion(Int64Request.create({ value: CURRENT_CLI_BANNER_VERSION })).catch(
				console.error,
			)
		}
	}, [])

	/**
	 * Build array of active banners for carousel
	 */
	const activeBanners = useMemo(() => {
		// Convert to BannerData format for carousel
		return bannerConfig.map((banner) =>
			convertBannerData(banner, {
				onAction: handleBannerAction,
				onDismiss: handleBannerDismiss,
			}),
		)
	}, [bannerConfig, clineUser, subagentsEnabled, handleBannerAction, handleBannerDismiss])

	return (
		<div className="flex flex-col flex-1 w-full h-full p-0 m-0">
			<WhatsNewModal onClose={handleCloseWhatsNewModal} open={showWhatsNewModal} version={version} />
			<div className="overflow-y-auto flex flex-col pb-2.5">
				<HomeHeader shouldShowQuickWins={shouldShowQuickWins} />
				{!showWhatsNewModal && (
					<>
						<div className="animate-fade-in">
							<BannerCarousel banners={activeBanners} />
						</div>
						{!shouldShowQuickWins && taskHistory.length > 0 && (
							<div className="animate-fade-in opacity-0">
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
