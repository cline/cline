import { ArrowLeftOutlined } from "@ant-design/icons"
import { Button } from "antd"
import React from "react"
import Announcement from "@/components/chat/Announcement"
import TelemetryBanner from "@/components/common/TelemetryBanner"
import HistoryPreview from "@/components/history/HistoryPreview"
import HomeHeader from "@/components/welcome/HomeHeader"
import { SuggestedTasks } from "@/components/welcome/SuggestedTasks"
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
	// 检查是否在CAN工具环境中
	const isCanToolEnvironment = window.location.pathname.includes("can-tool")

	const handleBackToCanView = () => {
		// 发送消息到VS Code扩展，请求切换回CanView
		if (typeof window !== "undefined" && (window as any).vscode) {
			;(window as any).vscode.postMessage({
				type: "switchToCanView",
			})
		}
	}

	return (
		<div className="flex flex-col flex-1 w-full h-full p-0 m-0">
			<div className="overflow-y-auto flex flex-col pb-2.5">
				{isCanToolEnvironment && (
					<div style={{ padding: "12px 16px 0 16px" }}>
						<Button
							icon={<ArrowLeftOutlined />}
							onClick={handleBackToCanView}
							style={{
								color: "var(--vscode-textLink-foreground)",
								padding: "4px 8px",
							}}
							type="text">
							返回CAN工具集
						</Button>
					</div>
				)}
				<TelemetryBanner />
				{showAnnouncement && <Announcement hideAnnouncement={hideAnnouncement} version={version} />}
				<div className="flex flex-col items-center justify-center flex-1 p-8 max-w-full">
					<div className="w-full max-w-md space-y-8">
						<HomeHeader />
						<SuggestedTasks shouldShowQuickWins={shouldShowQuickWins} />
						<HistoryPreview showHistoryView={showHistoryView} />
					</div>
				</div>
			</div>
		</div>
	)
}
