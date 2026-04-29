import { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/cline/common"
import { memo, useCallback, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

type FilterMode = "all" | "workspace"

const STORAGE_KEY = "historyPreviewFilter"

function getSavedFilter(): FilterMode {
	try {
		const saved = localStorage.getItem(STORAGE_KEY)
		if (saved === "workspace") return "workspace"
	} catch {}
	return "all"
}

/**
 * Extract a display name for the workspace from a task's path fields.
 */
function getWorkspaceLabel(item: HistoryItem): string {
	const p = item.cwdOnTaskInitialization || item.shadowGitConfigWorkTree
	if (!p) return "Unknown Workspace"
	const segments = p.replace(/\\/g, "/").split("/").filter(Boolean)
	return segments[segments.length - 1] || "Unknown Workspace"
}

/**
 * Group tasks by workspace label while preserving order.
 */
function groupByWorkspace(items: HistoryItem[]): { label: string; tasks: HistoryItem[] }[] {
	const groups: { label: string; tasks: HistoryItem[] }[] = []
	const seen = new Map<string, number>()

	for (const item of items) {
		const label = getWorkspaceLabel(item)
		const idx = seen.get(label)
		if (idx !== undefined) {
			groups[idx].tasks.push(item)
		} else {
			seen.set(label, groups.length)
			groups.push({ label, tasks: [item] })
		}
	}

	return groups
}

/**
 * Extract workspace folder name from workspaceRoots paths.
 */
function getWorkspaceFolderName(workspaceRoots: Array<{ path?: string; name?: string }>): string {
	if (!workspaceRoots || workspaceRoots.length === 0) return ""
	const root = workspaceRoots[0]
	if (root.name) return root.name
	const p = root.path
	if (!p) return ""
	const segments = p.replace(/\\/g, "/").split("/").filter(Boolean)
	return segments[segments.length - 1] || ""
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory, workspaceRoots } = useExtensionState()
	const [filter, setFilter] = useState<FilterMode>(getSavedFilter)

	const workspaceName = useMemo(() => getWorkspaceFolderName(workspaceRoots || []), [workspaceRoots])

	const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
		const newFilter = e.target.value as FilterMode
		setFilter(newFilter)
		try {
			localStorage.setItem(STORAGE_KEY, newFilter)
		} catch {}
	}, [])

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

	// Compute workspace path from workspaceRoots for local matching
	const currentWorkspacePath = useMemo(() => {
		if (!workspaceRoots || workspaceRoots.length === 0) return ""
		return workspaceRoots[0]?.path || ""
	}, [workspaceRoots])

	const isInCurrentWorkspace = useCallback(
		(item: HistoryItem) => {
			if (!currentWorkspacePath) return false
			const taskPath = item.cwdOnTaskInitialization || item.shadowGitConfigWorkTree
			if (!taskPath) return false
			// Normalize paths for comparison
			const normalize = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "")
			return normalize(taskPath) === normalize(currentWorkspacePath)
		},
		[currentWorkspacePath],
	)

	const allValidTasks = useMemo(() => taskHistory.filter((item) => item.ts && item.task), [taskHistory])

	const displayTasks = useMemo(() => {
		if (filter === "workspace") {
			return allValidTasks.filter((item) => isInCurrentWorkspace(item)).slice(0, 5)
		}
		return [...allValidTasks].sort((a, b) => b.ts - a.ts).slice(0, 5)
	}, [allValidTasks, filter, isInCurrentWorkspace])

	const workspaceGroups = useMemo(() => groupByWorkspace(displayTasks), [displayTasks])
	const hasMultipleWorkspaces = filter === "all" && workspaceGroups.length > 1

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
						margin-bottom: 6px;
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
					.history-workspace-divider {
						display: flex;
						align-items: center;
						gap: 6px;
						padding: 6px 0 4px 0;
						color: var(--vscode-descriptionForeground);
						font-size: 0.75em;
						font-weight: 600;
						text-transform: uppercase;
						letter-spacing: 0.04em;
					}
					.history-workspace-divider::after {
						content: '';
						flex: 1;
						height: 1px;
						background: color-mix(in srgb, var(--vscode-descriptionForeground) 25%, transparent);
					}
					.history-filter-select {
						background: none;
						border: 1px solid color-mix(in srgb, var(--vscode-descriptionForeground) 30%, transparent);
						border-radius: 3px;
						color: var(--vscode-descriptionForeground);
						font-weight: 500;
						font-size: 0.8em;
						cursor: pointer;
						padding: 1px 4px;
						margin-left: 6px;
						outline: none;
						font-family: inherit;
					}
					.history-filter-select:hover,
					.history-filter-select:focus {
						color: var(--vscode-foreground);
						border-color: color-mix(in srgb, var(--vscode-descriptionForeground) 60%, transparent);
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
						}}
					/>
					<span
						style={{
							fontWeight: 500,
							fontSize: "0.85em",
							textTransform: "uppercase",
						}}>
						Recent Tasks
					</span>
					{workspaceName && (
						<select className="history-filter-select" onChange={handleFilterChange} value={filter}>
							<option value="all">All</option>
							<option value="workspace">{workspaceName}</option>
						</select>
					)}
				</div>
				{displayTasks.length > 0 && (
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

			<div className="px-4">
				{displayTasks.length > 0 ? (
					workspaceGroups.map((group) => (
						<div key={group.label}>
							{hasMultipleWorkspaces && (
								<div className="history-workspace-divider">
									<span className="codicon codicon-folder" style={{ fontSize: "0.9em" }} />
									{group.label}
								</div>
							)}
							{group.tasks.map((item) => (
								<div className="history-preview-item" key={item.id} onClick={() => handleHistorySelect(item.id)}>
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
						{filter === "workspace" ? "No tasks in this workspace" : "No recent tasks"}
					</div>
				)}
			</div>
		</div>
	)
}

export default memo(HistoryPreview)
