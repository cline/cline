import { StringRequest } from "@shared/proto/cline/common"
import { memo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory } = useExtensionState()
	const handleHistorySelect = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp)
		return date?.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
		})
	}

	return (
		<div style={{ flexShrink: 0 }}>
			<style>
				{`
					.history-preview-item {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent);
						border-radius: 4px;
						position: relative;
						overflow: hidden;
						cursor: pointer;
						margin-bottom: 8px;
						padding: 10px 12px;
						display: flex;
						align-items: flex-start;
						gap: 12px;
					}
					.history-preview-item.pinned {
						border-bottom: 3px solid var(--vscode-button-background);
					}
					.history-preview-item:hover {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 100%, transparent);
						pointer-events: auto;
					}
					.history-task-content {
						flex: 1;
						display: flex;
						align-items: flex-start;
						gap: 8px;
						min-width: 0;
					}
					.history-task-description {
						flex: 1;
						overflow: hidden;
						display: -webkit-box;
						-webkit-line-clamp: 2;
						-webkit-box-orient: vertical;
						color: var(--vscode-foreground);
						font-size: var(--vscode-font-size);
						line-height: 1.4;
					}
					.history-meta-stack {
						display: flex;
						flex-direction: column;
						align-items: center;
						gap: 4px;
						flex-shrink: 0;
					}
					.history-date {
						color: var(--vscode-descriptionForeground);
						font-size: 0.85em;
						white-space: nowrap;
					}
					.history-cost-chip {
						background-color: var(--vscode-badge-background);
						color: var(--vscode-badge-foreground);
						padding: 2px 8px;
						border-radius: 12px;
						font-size: 0.85em;
						font-weight: 500;
						white-space: nowrap;
					}
					.history-view-all-btn {
						background: none;
						border: none;
						padding: 4px 0 4px 8px;
						cursor: pointer;
						font-size: 0.85em;
						font-weight: 500;
						color: var(--vscode-descriptionForeground);
						white-space: nowrap;
						display: flex;
						align-items: center;
						gap: 2px;
					}
					.history-view-all-btn .codicon {
						font-size: 1.2em;
					}
					.history-view-all-btn:hover {
						color: var(--vscode-foreground);
					}
					.history-pin-badge {
						position: absolute;
						bottom: 0;
						left: 8px;
						background-color: var(--vscode-button-background);
						border-radius: 2px 2px 0 0;
						padding: 1px 3px;
						display: flex;
						align-items: center;
						justify-content: center;
						z-index: 1;
					}
					.history-pin-badge .codicon {
						color: var(--vscode-button-foreground);
						font-size: 12px;
						transform: rotate(-90deg);
					}
				`}
			</style>

			<div
				className="history-header"
				style={{
					color: "var(--vscode-descriptionForeground)",
					margin: "10px 16px 10px 16px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}>
				<div style={{ display: "flex", alignItems: "center" }}>
					<span
						className="codicon codicon-comment-discussion"
						style={{
							marginRight: "4px",
							transform: "scale(0.9)",
						}}></span>
					<span
						style={{
							fontWeight: 500,
							fontSize: "0.85em",
							textTransform: "uppercase",
						}}>
						Recent
					</span>
				</div>
				{taskHistory.filter((item) => item.ts && item.task).length > 0 && (
					<button
						aria-label="View all history"
						className="history-view-all-btn"
						onClick={() => showHistoryView()}
						type="button">
						View All
						<span className="codicon codicon-chevron-right" />
					</button>
				)}
			</div>

			{
				<div className="px-4">
					{taskHistory.filter((item) => item.ts && item.task).length > 0 ? (
						taskHistory
							.filter((item) => item.ts && item.task)
							.sort((a, b) => {
								// Pinned tasks first
								if (a.isPinned !== b.isPinned) {
									return a.isPinned ? -1 : 1
								}
								// Then by timestamp (newest first)
								return b.ts - a.ts
							})
							.slice(0, 5)
							.map((item) => (
								<div
									className={`history-preview-item ${item.isPinned ? "pinned" : ""}`}
									key={item.id}
									onClick={() => handleHistorySelect(item.id)}>
									{item.isPinned && (
										<div
											aria-label="Pinned"
											className="history-pin-badge"
											onClick={async (e) => {
												e.stopPropagation()
												// Toggle pin status
												try {
													const { TaskPinRequest } = await import("@shared/proto/cline/task")
													await TaskServiceClient.toggleTaskPin(
														TaskPinRequest.create({
															taskId: item.id,
															isPinned: false,
														}),
													)
												} catch (error) {
													console.error("Error unpinning task:", error)
												}
											}}
											style={{
												cursor: "pointer",
											}}>
											<span className="codicon codicon-pin" />
										</div>
									)}
									<div className="history-task-content">
										{item.isFavorited && (
											<span
												aria-label="Favorited"
												className="codicon codicon-star-full"
												onClick={async (e) => {
													e.stopPropagation()
													// Toggle favorite status
													try {
														const { TaskFavoriteRequest } = await import("@shared/proto/cline/task")
														await TaskServiceClient.toggleTaskFavorite(
															TaskFavoriteRequest.create({
																taskId: item.id,
																isFavorited: false,
															}),
														)
													} catch (error) {
														console.error("Error unfavoriting task:", error)
													}
												}}
												style={{
													color: "var(--vscode-button-background)",
													flexShrink: 0,
													cursor: "pointer",
												}}
											/>
										)}
										<div className="history-task-description ph-no-capture">
											{item.customName || item.task}
										</div>
									</div>
									<div className="history-meta-stack">
										{item.totalCost != null && (
											<span className="history-cost-chip">${item.totalCost.toFixed(2)}</span>
										)}
										<span className="history-date">{formatDate(item.ts)}</span>
									</div>
								</div>
							))
					) : (
						<div
							style={{
								textAlign: "center",
								color: "var(--vscode-descriptionForeground)",
								fontSize: "var(--vscode-font-size)",
								padding: "10px 0",
							}}>
							No recent tasks
						</div>
					)}
				</div>
			}
		</div>
	)
}

export default memo(HistoryPreview)
