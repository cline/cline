import { StringRequest } from "@shared/proto/cline/common"
import { memo, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { Button } from "../ui/button"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { activeTasks, taskHistory } = useExtensionState()
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

	// Get the top 3 history items, but preserve the order of active tasks
	// Active tasks should maintain their position from activeTasks array to prevent reordering while displayed
	const displayItems = useMemo(() => {
		const validItems = taskHistory.filter((item) => item.ts && item.task).slice(0, 3)

		if (!activeTasks?.length) {
			return validItems
		}

		// Reverse active tasks to maintain their order when sorting
		const reversedActiveTasks = [...activeTasks].reverse()
		// Create a map of taskId to its index in activeTasks for quick lookup
		const activeTaskIndexMap = new Map(reversedActiveTasks.map((t, i) => [t?.taskId, i]))

		// Sort items: active tasks maintain their relative order from activeTasks,
		// non-active tasks come after in their original order
		return [...validItems].sort((a, b) => {
			const aActiveIndex = activeTaskIndexMap.get(a.id)
			const bActiveIndex = activeTaskIndexMap.get(b.id)

			const aIsActive = aActiveIndex !== undefined
			const bIsActive = bActiveIndex !== undefined

			if (aIsActive && bIsActive) {
				// Both are active: preserve activeTasks order
				return aActiveIndex - bActiveIndex
			} else if (aIsActive) {
				// Only a is active: a comes first
				return -1
			} else if (bIsActive) {
				// Only b is active: b comes first
				return 1
			} else {
				// Neither is active: preserve original taskHistory order
				return 0
			}
		})
	}, [taskHistory, activeTasks])

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

			<div className="history-header text-description my-2.5 mx-4 flex items-center">
				<span className="codicon codicon-comment-discussion mr-1 scale-90"></span>
				<span className="font-medium text-sm uppercase">Recent Tasks</span>
			</div>

			{
				<div className="px-4">
					{displayItems.length > 0 ? (
						<>
							{displayItems.map((item) => (
								<div className="history-preview-item" key={item.id} onClick={() => handleHistorySelect(item.id)}>
									<div className="history-task-content">
										<div
											className={cn("w-0 h-0 rounded-full self-center", {
												"w-2 h-2 bg-success":
													activeTasks?.find((task) => task.taskId === item.id)?.status === "active",
												"w-2 h-2 bg-warning":
													activeTasks?.find((task) => task.taskId === item.id)?.status === "pending",
												"w-2 h-2 bg-error":
													activeTasks?.find((task) => task.taskId === item.id)?.status === "error",
											})}
										/>
										{item.isFavorited && (
											<span
												aria-label="Favorited"
												className="codicon codicon-star-full shrink-0 bg-button-background"
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
							<div className="flex items-center justify-center">
								<Button
									aria-label="View all history"
									onClick={() => showHistoryView()}
									style={{
										opacity: 0.9,
									}}
									variant="ghost">
									<div className="text-base text-description">View All</div>
								</Button>
							</div>
						</>
					) : (
						<div className="text-center text-description font-base py-2.5">No recent tasks</div>
					)}
				</div>
			}
		</div>
	)
}

export default memo(HistoryPreview)
