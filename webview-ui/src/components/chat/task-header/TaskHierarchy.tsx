import React, { useState, useMemo, useEffect, ReactNode } from "react"
import { Spinner } from "@heroui/react"
import { Checkbox } from "@heroui/react"
import { HistoryItem } from "@shared/HistoryItem"
import { vscode } from "@/utils/vscode"
import HeroTooltip from "@/components/common/HeroTooltip"

interface TaskHierarchyProps {
	currentTask: HistoryItem
	allTasks: HistoryItem[]
	onTaskClick?: (taskId: string) => void
	isTaskExpanded: boolean
}

export const TaskHierarchy: React.FC<TaskHierarchyProps> = ({ currentTask, allTasks, onTaskClick, isTaskExpanded }) => {
	// get current task's child tasks from history
	const existingChildTasks = allTasks.filter((task) => task.parentId === currentTask.id)
	// get current task's pending child tasks from pendingChildTasks
	const pendingChildTasks = (currentTask.pendingChildTasks || []).map((pendingTask) => ({
		id: pendingTask.id,
		ts: pendingTask.createdAt,
		task: pendingTask.prompt,
		status: "pending" as const,
		parentId: currentTask.id,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
	}))

	// merge existing child tasks and pending child tasks
	const childTasks = [...existingChildTasks, ...pendingChildTasks].sort((a, b) => b.ts - a.ts)
	const COLLAPSE_THRESHOLD = 5
	const COLLAPSED_SHOW_COUNT = 0

	const [isExpanded, setIsExpanded] = useState(() => {
		return childTasks.length <= COLLAPSE_THRESHOLD
	})

	useEffect(() => {
		if (!isTaskExpanded) {
			setIsExpanded(false)
		}
	}, [isTaskExpanded])
	const getStatusIcon = (status?: string) => {
		switch (status) {
			case "running":
			case "paused":
				return (
					<Spinner
						color="primary"
						size="sm"
						style={{
							transform: "scale(0.7)",
							marginLeft: "-8px",
							color: "var(--checkbox-foreground)",
						}}
					/>
				)
			case "completed":
				return (
					<Checkbox
						style={{
							transform: "scale(0.9)",
							color: "var(--button-primary-background)",
						}}
						isSelected={true}
						isReadOnly
						size="sm"
						color="success"
					/>
				)
			case "failed":
				return (
					<Checkbox
						style={{
							transform: "scale(0.9)",
							color: "var(--checkbox-foreground)",
						}}
						isSelected={false}
						isReadOnly
						size="sm"
						color="danger"
					/>
				)
			case "pending":
			default:
				return (
					<Checkbox
						style={{
							transform: "scale(0.9)",
							color: "var(--checkbox-foreground)",
						}}
						isSelected={false}
						isReadOnly
						size="sm"
						color="default"
					/>
				)
		}
	}

	const getStatusColor = (status?: string) => {
		switch (status) {
			case "running":
				return "var(--checkbox-foreground)"
			case "paused":
				return "var(--vscode-terminal-ansiYellow)"
			case "completed":
				return "var(--button-primary-background)"
			case "failed":
				return "var(--vscode-terminal-ansiRed)"
			default:
				return "var(--vscode-foreground)"
		}
	}

	const displayTasks = isExpanded ? childTasks : childTasks.slice(0, COLLAPSED_SHOW_COUNT)
	const hiddenCount = childTasks.length - COLLAPSED_SHOW_COUNT

	const statusSummary = useMemo(() => {
		const statusCount = childTasks.reduce(
			(acc, task) => {
				const status = task.status || "unknown"
				acc[status] = (acc[status] || 0) + 1
				return acc
			},
			{} as Record<string, number>,
		)

		return Object.entries(statusCount)
			.filter(([_, count]) => count > 0)
			.map(([status, count]) => (
				<div
					key={status}
					style={{
						display: "flex",
						alignItems: "center",
						gap: "4px",
						fontSize: "11px",
					}}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: "16px",
							height: "16px",
						}}>
						{getStatusIcon(status)}
					</div>
					<span style={{ color: getStatusColor(status) }}>{count}</span>
				</div>
			))
	}, [childTasks])

	const handleToggle = () => {
		setIsExpanded(!isExpanded)
	}
	if (childTasks.length === 0) {
		return null
	}
	const renderListInContainer = (childTask: HistoryItem, children: ReactNode) => {
		if (childTask.status === "pending") {
			return (
				<HeroTooltip key={childTask.id} content="Task is pending">
					{children}
				</HeroTooltip>
			)
		}
		return children
	}

	return (
		<div
			style={{
				marginTop: "12px",
				padding: "12px",
				backgroundColor: "var(--vscode-editor-background)",
				border: "1px solid var(--vscode-panel-border)",
				borderRadius: "4px",
			}}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					cursor: "pointer",
					padding: "4px 0",
					marginBottom: "8px",
					userSelect: "none",
				}}
				onClick={handleToggle}>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "6px",
						fontSize: "13px",
						fontWeight: "bold",
						color: "var(--vscode-foreground)",
					}}>
					<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`} style={{ fontSize: "12px" }} />
					<span>Child Task ({childTasks.length})</span>
					{!isExpanded && hiddenCount > 0 && (
						<span
							style={{
								fontSize: "11px",
								color: "var(--vscode-descriptionForeground)",
								fontWeight: "normal",
							}}>
							+{hiddenCount} more
						</span>
					)}
				</div>

				<div
					style={{
						display: "flex",
						gap: "8px",
						alignItems: "center",
					}}>
					{statusSummary}
				</div>
			</div>

			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "6px",
					overflow: "hidden",
					transition: "all 0.2s ease-in-out",
				}}>
				{displayTasks.map((childTask, index) =>
					renderListInContainer(
						childTask,
						<div
							key={childTask.id}
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								padding: "6px 8px",
								backgroundColor: "var(--vscode-list-hoverBackground)",
								borderRadius: "3px",
								cursor: onTaskClick ? "pointer" : "default",
								fontSize: "12px",
								transition: "background-color 0.1s ease",
							}}
							onClick={(e) => {
								if (childTask.status === "pending") {
									return
								}
								e.stopPropagation()
								onTaskClick?.(childTask.id)
							}}
							onMouseEnter={(e) => {
								if (onTaskClick) {
									e.currentTarget.style.backgroundColor = "var(--vscode-list-activeSelectionBackground)"
								}
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.backgroundColor = "var(--vscode-list-hoverBackground)"
							}}>
							<span
								style={{
									minWidth: "16px",
									fontSize: "14px",
									color: "var(--vscode-descriptionForeground)",
								}}>
								{index + 1}.
							</span>

							{childTask.status && (
								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										minWidth: "20px",
										height: "20px",
									}}>
									{getStatusIcon(childTask.status)}
								</div>
							)}

							<span
								style={{
									flex: 1,
									color: "var(--vscode-foreground)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}>
								<span
									style={{
										fontSize: "10px",
										color: "var(--vscode-descriptionForeground)",
										marginRight: "6px",
										fontStyle: "italic",
									}}>
									[{childTask.status}]
								</span>
								{childTask.task}
							</span>

							<span
								style={{
									fontSize: "10px",
									color: "var(--vscode-descriptionForeground)",
									minWidth: "fit-content",
								}}>
								{new Date(childTask.ts).toLocaleTimeString()}
							</span>
						</div>,
					),
				)}
			</div>
			{!isExpanded && hiddenCount > 0 && (
				<div
					style={{
						marginTop: "8px",
						padding: "4px 8px",
						textAlign: "center",
						fontSize: "11px",
						color: "var(--vscode-descriptionForeground)",
						cursor: "pointer",
						borderRadius: "3px",
						backgroundColor: "var(--vscode-button-secondaryBackground)",
						border: "1px solid var(--vscode-button-border)",
					}}
					onClick={handleToggle}
					onMouseEnter={(e) => {
						e.currentTarget.style.backgroundColor = "var(--vscode-button-secondaryHoverBackground)"
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.backgroundColor = "var(--vscode-button-secondaryBackground)"
					}}>
					Click to expand all tasks ({hiddenCount} hidden)
				</div>
			)}
		</div>
	)
}
