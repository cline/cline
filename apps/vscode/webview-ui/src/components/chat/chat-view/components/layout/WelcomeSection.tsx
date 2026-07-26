import type React from "react"
import HistoryPreview from "@/components/history/HistoryPreview"
import HomeHeader from "@/components/welcome/HomeHeader"
import type { WelcomeSectionProps } from "../../types/chatTypes"

export const WelcomeSection: React.FC<WelcomeSectionProps> = ({ showHistoryView, taskHistory }) => (
	<div className="flex flex-col flex-1 w-full h-full p-0 m-0">
		<div className="overflow-y-auto flex flex-col pb-2.5">
			<HomeHeader />
			{taskHistory.length > 0 && <HistoryPreview showHistoryView={showHistoryView} />}
		</div>
	</div>
)
