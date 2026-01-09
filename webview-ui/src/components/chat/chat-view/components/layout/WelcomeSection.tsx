import { BannerAction, BannerActionType } from "@shared/cline/banner"
import { EmptyRequest } from "@shared/proto/index.cline"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import BannerCarousel from "@/components/common/BannerCarousel"
import WhatsNewModal from "@/components/common/WhatsNewModal"
import HistoryPreview from "@/components/history/HistoryPreview"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import HomeHeader from "@/components/welcome/HomeHeader"
import { SuggestedTasks } from "@/components/welcome/SuggestedTasks"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient, StateServiceClient } from "@/services/grpc-client"
import { convertBannerData } from "@/utils/bannerUtils"
import { WelcomeSectionProps } from "../../types/chatTypes"

const CURRENT_INFO_BANNER_VERSION = 1
const CURRENT_MODEL_BANNER_VERSION = 1
const CURRENT_CLI_BANNER_VERSION = 1

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
	// Track if we've shown the "What's New" modal this session
	const [hasShownWhatsNewModal, setHasShownWhatsNewModal] = useState(false)
	const [showWhatsNewModal, setShowWhatsNewModal] = useState(false)

	const { openRouterModels, setShowChatModelSelector, navigateToSettings, activeBanners } = useExtensionState()
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
		StateServiceClient.dismissBanner({ value: bannerId })
	}, [])

	/**
	 * Build array of banner data for carousel from state
	 */
	const bannerData = useMemo(() => {
		// Convert to BannerData format for carousel
		return (activeBanners || []).map((banner) =>
			convertBannerData(banner, {
				onAction: handleBannerAction,
				onDismiss: handleBannerDismiss,
			}),
		)
	}, [activeBanners, handleBannerAction, handleBannerDismiss])

	return (
		<div className="flex flex-col flex-1 w-full h-full p-0 m-0">
			<WhatsNewModal onClose={handleCloseWhatsNewModal} open={showWhatsNewModal} version={version} />
			<div className="overflow-y-auto flex flex-col pb-2.5">
				<HomeHeader shouldShowQuickWins={shouldShowQuickWins} />
				{!showWhatsNewModal && (
					<>
						<div className="animate-fade-in">
							<BannerCarousel banners={bannerData} />
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
