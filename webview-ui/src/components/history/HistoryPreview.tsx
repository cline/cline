import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatLargeNumber } from "@/utils/format"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory } = useExtensionState()
	const [isExpanded, setIsExpanded] = useState(true)

	const handleHistorySelect = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}

	const toggleExpanded = () => {
		setIsExpanded(!isExpanded)
	}

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp)
		return date
			?.toLocaleString("en-US", {
				month: "long",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			})
			.replace(", ", " ")
			.replace(" at", ",")
			.toUpperCase()
	}

	return (
		<div className="shrink-0">
			<div className="cursor-pointer select-none history-preview-toggle" onClick={toggleExpanded}>
				{" "}
				<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"} mr-1 scale-90 inline-block`} />
				<span className="codicon codicon-comment-discussion mr-1 scale-90 inline-block" />
				<span className="font-medium text-[0.85em] uppercase">Recent Tasks</span>
			</div>

			{isExpanded && (
				<div className="px-5">
					{taskHistory.filter((item) => item.ts && item.task).length > 0 ? (
						<>
							{taskHistory
								.filter((item) => item.ts && item.task)
								.slice(0, 3)
								.map((item) => (
									<div
										className="modern-card cursor-pointer relative overflow-hidden mb-2.5"
										key={item.id}
										onClick={() => handleHistorySelect(item.id)}>
										<div className="p-3">
											<div className="flex items-center gap-2 mb-2">
												<span className="timestamp-text">{formatDate(item.ts)}</span>
												{item.isFavorited && (
													<span className="chip chip-ocean ml-auto">
														<span className="codicon codicon-star-full text-[10px]" />
														Favorited
													</span>
												)}
											</div>{" "}
											<div className="history-preview-task-text" id={`history-preview-task-${item.id}`}>
												<span className="ph-no-capture">{item.task}</span>
											</div>
											<div className="flex flex-wrap items-center gap-2">
												<span className="modern-badge">
													<span className="codicon codicon-arrow-up text-[10px]" />
													{formatLargeNumber(item.tokensIn || 0)}
												</span>
												<span className="modern-badge">
													<span className="codicon codicon-arrow-down text-[10px]" />
													{formatLargeNumber(item.tokensOut || 0)}
												</span>
												{!!item.cacheWrites && (
													<span className="modern-badge">
														<span className="codicon codicon-database text-[10px]" />+
														{formatLargeNumber(item.cacheWrites || 0)}
													</span>
												)}
												{!!item.totalCost && (
													<span className="chip chip-teal">
														<span className="codicon codicon-credit-card text-[10px]" />$
														{item.totalCost?.toFixed(4)}
													</span>
												)}
											</div>
										</div>
									</div>
								))}
							<div className="flex items-center justify-center mt-2">
								<VSCodeButton
									appearance="icon"
									aria-label="View all history"
									className="opacity-90 hover:opacity-100 transition-opacity"
									onClick={() => showHistoryView()}>
									<div className="history-preview-view-all">View all history</div>
								</VSCodeButton>
							</div>
						</>
					) : (
						<div className="modern-card history-preview-empty">
							<span className="codicon codicon-history mr-1.5" />
							No recent tasks
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default memo(HistoryPreview)
