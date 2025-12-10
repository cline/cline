import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
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
				`}
			</style>

			<div
				className="history-header"
				style={{
					color: "var(--vscode-descriptionForeground)",
					margin: "10px 16px 10px 16px",
					display: "flex",
					alignItems: "center",
				}}>
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
					Recent Tasks
				</span>
			</div>

			{
				<div className="px-4">
					{taskHistory.filter((item) => item.ts && item.task).length > 0 ? (
						<>
							{taskHistory
								.filter((item) => item.ts && item.task)
								.slice(0, 3)
								.map((item) => (
									<div
										className="history-preview-item"
										key={item.id}
										onClick={() => handleHistorySelect(item.id)}>
										<div className="history-task-content">
											{item.isFavorited && (
												<span
													aria-label="Favorited"
													className="codicon codicon-star-full"
													style={{
														color: "var(--vscode-button-background)",
														flexShrink: 0,
													}}
												/>
											)}
											<div className="history-task-description ph-no-capture">{item.task}</div>
										</div>
										<div className="history-meta-stack">
											<span className="history-date">{formatDate(item.ts)}</span>
											{item.totalCost != null && (
												<span className="history-cost-chip">${item.totalCost.toFixed(2)}</span>
											)}
										</div>
									</div>
								))}
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "flex-start",
								}}>
								<VSCodeButton
									appearance="icon"
									aria-label="View all history"
									onClick={() => showHistoryView()}
									style={{
										opacity: 0.9,
									}}>
									<div
										style={{
											fontSize: "var(--vscode-font-size)",
											color: "var(--vscode-descriptionForeground)",
										}}>
										View All
									</div>
								</VSCodeButton>
							</div>
						</>
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
