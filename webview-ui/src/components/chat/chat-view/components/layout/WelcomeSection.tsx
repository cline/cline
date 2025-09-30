import React from "react"
import Announcement from "@/components/chat/Announcement"
import InfoBanner, { CURRENT_INFO_BANNER_VERSION } from "@/components/common/InfoBanner"
import NewModelBanner, { CURRENT_MODEL_BANNER_VERSION } from "@/components/common/NewModelBanner"
import HistoryPreview from "@/components/history/HistoryPreview"
import HomeHeader from "@/components/welcome/HomeHeader"
import { SuggestedTasks } from "@/components/welcome/SuggestedTasks"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { WelcomeSectionProps } from "../../types/chatTypes"

/**
 * Welcome section shown when there's no active task
 * Includes info banner, announcements, home header, and history preview
 */
export const WelcomeSection: React.FC<WelcomeSectionProps> = ({
	showAnnouncement,
	hideAnnouncement,
	showHistoryView,
	telemetrySetting,
	version,
	taskHistory,
	shouldShowQuickWins,
}) => {
	const { lastDismissedInfoBannerVersion, lastDismissedModelBannerVersion } = useExtensionState()

	const shouldShowInfoBanner = lastDismissedInfoBannerVersion < CURRENT_INFO_BANNER_VERSION
	const shouldShowNewModelBanner = lastDismissedModelBannerVersion < CURRENT_MODEL_BANNER_VERSION

	return (
		<div className="flex flex-col flex-1 w-full h-full p-0 m-0">
			<div className="overflow-y-auto flex flex-col pb-2.5">
				{shouldShowInfoBanner && <InfoBanner />}
				{showAnnouncement && <Announcement hideAnnouncement={hideAnnouncement} version={version} />}
				{shouldShowNewModelBanner && <NewModelBanner />}
				<HomeHeader shouldShowQuickWins={shouldShowQuickWins} />
				{!shouldShowQuickWins && taskHistory.length > 0 && <HistoryPreview showHistoryView={showHistoryView} />}
			</div>
			<SuggestedTasks shouldShowQuickWins={shouldShowQuickWins} />
		</div>
	)
}
