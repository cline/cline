import React from "react"
import HistoryPreview from "@/components/history/HistoryPreview"
import { WhatsNew } from "@/components/onboarding/WhatsNew"
import HomeHeader from "@/components/welcome/HomeHeader"
import { SuggestedTasks } from "@/components/welcome/SuggestedTasks"
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
	return (
		<div className="flex flex-col flex-1 w-full h-full p-0 m-0">
			<div className="overflow-y-auto flex flex-col pb-2.5">
				<HomeHeader shouldShowQuickWins={shouldShowQuickWins} />
				<WhatsNew hideAnnouncement={hideAnnouncement} version={version} />
				{showAnnouncement && <WhatsNew hideAnnouncement={hideAnnouncement} version={version} />}
				{!shouldShowQuickWins && taskHistory.length > 0 && <HistoryPreview showHistoryView={showHistoryView} />}
			</div>
			<SuggestedTasks shouldShowQuickWins={shouldShowQuickWins} />
		</div>
	)
}
