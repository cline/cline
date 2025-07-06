import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatLargeNumber } from "@/utils/format"
import { StringRequest } from "@shared/proto/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"

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
		<div className="flex-shrink-0">
			<div
				className="flex items-center gap-2 mx-5 my-2 cursor-pointer select-none text-[var(--vscode-descriptionForeground)] hover:opacity-80 transition-all duration-200 rounded-lg px-2 py-1 hover:bg-[var(--vscode-toolbar-hoverBackground)]"
				onClick={toggleExpanded}>
				<span
					className={`codicon codicon-chevron-${isExpanded ? "down" : "right"} scale-90 transition-transform duration-200`}
				/>
				<span className="codicon codicon-comment-discussion scale-90" />
				<span className="font-medium text-xs uppercase tracking-wide">Recent Tasks</span>
			</div>

			{isExpanded && (
				<div className="px-5 space-y-3">
					{taskHistory.filter((item) => item.ts && item.task).length > 0 ? (
						<>
							{taskHistory
								.filter((item) => item.ts && item.task)
								.slice(0, 3)
								.map((item) => (
									<div
										key={item.id}
										className="relative rounded-xl p-3 cursor-pointer overflow-hidden transition-all duration-150 ease-out hover:scale-[1.02] hover:shadow-xl group hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_50%,transparent)] hover:border-[color-mix(in_srgb,var(--vscode-panel-border)_80%,transparent)]"
										style={{
											backgroundColor:
												"color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 30%, transparent)",
											border: "1px solid color-mix(in srgb, var(--vscode-panel-border) 50%, transparent)",
											backdropFilter: "blur(8px)",
										}}
										onClick={() => handleHistorySelect(item.id)}>
										{/* Subtle gradient overlay for extra depth */}
										<div
											className="absolute inset-0 transition-all duration-150 rounded-xl opacity-0 group-hover:opacity-100"
											style={{
												background:
													"linear-gradient(135deg, color-mix(in srgb, var(--vscode-button-background) 5%, transparent) 0%, color-mix(in srgb, var(--vscode-focusBorder) 3%, transparent) 100%)",
											}}
										/>

										{item.isFavorited && (
											<div
												className="absolute top-3 right-3 z-20 drop-shadow-sm"
												style={{ color: "var(--vscode-button-background)" }}>
												<span className="codicon codicon-star-full" aria-label="Favorited" />
											</div>
										)}

										<div className="relative z-10">
											<div className="mb-2">
												<span className="text-[var(--vscode-descriptionForeground)] font-medium text-xs uppercase tracking-wider opacity-80">
													{formatDate(item.ts)}
												</span>
											</div>

											<div
												id={`history-preview-task-${item.id}`}
												className="text-[var(--vscode-descriptionForeground)] mb-2 line-clamp-3 whitespace-pre-wrap break-words"
												style={{ fontSize: "var(--vscode-font-size)" }}>
												<span className="ph-no-capture">{item.task}</span>
											</div>

											<div className="text-xs text-[var(--vscode-descriptionForeground)] opacity-75 space-x-1">
												<span>
													Tokens: ↑{formatLargeNumber(item.tokensIn || 0)} ↓
													{formatLargeNumber(item.tokensOut || 0)}
												</span>
												{!!item.cacheWrites && (
													<>
														<span
															style={{
																color: "color-mix(in srgb, var(--vscode-descriptionForeground) 40%, transparent)",
															}}>
															•
														</span>
														<span>
															Cache: +{formatLargeNumber(item.cacheWrites || 0)} →{" "}
															{formatLargeNumber(item.cacheReads || 0)}
														</span>
													</>
												)}
												{!!item.totalCost && (
													<>
														<span
															style={{
																color: "color-mix(in srgb, var(--vscode-descriptionForeground) 40%, transparent)",
															}}>
															•
														</span>
														<span>API Cost: ${item.totalCost?.toFixed(4)}</span>
													</>
												)}
											</div>
										</div>
									</div>
								))}
							<div className="flex items-center justify-center pt-2">
								<button
									onClick={() => showHistoryView()}
									className="cursor-pointer text-center transition-all duration-150 hover:opacity-80 flex items-center gap-1 bg-transparent border-none outline-none focus:outline-none"
									style={{
										color: "var(--vscode-descriptionForeground)",
										fontSize: "var(--vscode-font-size)",
									}}>
									<span className="codicon codicon-history scale-90"></span>
									<span className="font-medium">View all history</span>
								</button>
							</div>
						</>
					) : (
						<div
							className="text-center text-[var(--vscode-descriptionForeground)] py-4 rounded-xl"
							style={{
								fontSize: "var(--vscode-font-size)",
								backgroundColor: "color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 20%, transparent)",
								border: "1px solid color-mix(in srgb, var(--vscode-panel-border) 30%, transparent)",
								backdropFilter: "blur(8px)",
							}}>
							No recent tasks
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default memo(HistoryPreview)
