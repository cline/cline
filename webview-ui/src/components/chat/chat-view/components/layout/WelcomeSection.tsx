import React from "react"
import TelemetryBanner from "@/components/common/TelemetryBanner"
import Announcement from "@/components/chat/Announcement"
import HomeHeader from "@/components/welcome/HomeHeader"
import HistoryPreview from "@/components/history/HistoryPreview"
import { SuggestedTasks } from "@/components/welcome/SuggestedTasks"
import AutoApproveBar from "@/components/chat/auto-approve-menu/AutoApproveBar"
import { WelcomeSectionProps } from "../../types/chatTypes"

/**
 * Welcome section shown when there's no active task
 * Includes telemetry banner, announcements, home header, and history preview
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
	return (
		<div className="flex flex-col flex-1 w-full h-full p-0 m-0">
			<div className="overflow-y-auto flex flex-col pb-2.5">
				{telemetrySetting === "unset" && <TelemetryBanner />}
				{showAnnouncement && <Announcement version={version} hideAnnouncement={hideAnnouncement} />}
				<HomeHeader shouldShowQuickWins={shouldShowQuickWins} />
				{!shouldShowQuickWins && taskHistory.length > 0 && <HistoryPreview showHistoryView={showHistoryView} />}
			</div>
			<SuggestedTasks shouldShowQuickWins={shouldShowQuickWins} />
		</div>
	)
}
