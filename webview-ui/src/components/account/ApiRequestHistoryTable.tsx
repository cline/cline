import { ApiRequestHistoryEntry } from "@shared/ClineAccount"
import { VSCodeDataGrid, VSCodeDataGridCell, VSCodeDataGridRow } from "@vscode/webview-ui-toolkit/react"
import { memo, useMemo } from "react"

type ApiRequestHistoryTableProps = {
	isLoading: boolean
	historyData: ApiRequestHistoryEntry[]
}

const ApiRequestHistoryTable = ({ isLoading, historyData }: ApiRequestHistoryTableProps) => {
	const sortedHistory = useMemo(() => {
		// Sort by taskId, then by timestamp descending
		return [...historyData].sort((a, b) => {
			if (a.taskId < b.taskId) return -1
			if (a.taskId > b.taskId) return 1
			return b.timestamp - a.timestamp // Newest first within a task
		})
	}, [historyData])

	const summary = useMemo(() => {
		const totalRequests = sortedHistory.length
		const totalTokens = sortedHistory.reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0)
		const totalCost = sortedHistory.reduce((sum, entry) => sum + (entry.cost || 0), 0)
		return { totalRequests, totalTokens, totalCost }
	}, [sortedHistory])

	if (isLoading) {
		return <div className="text-[var(--vscode-descriptionForeground)]">Loading...</div>
	}

	return (
		<div className="flex flex-col flex-grow min-h-0">
			<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-1">API REQUEST HISTORY SUMMARY</div>
			<div className="text-xs text-[var(--vscode-descriptionForeground)] mb-3">
				Total Requests: {summary.totalRequests} | Total Tokens: {summary.totalTokens.toLocaleString()} | Total Cost: $
				{summary.totalCost.toFixed(4)}
			</div>
			<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-1">DETAILS</div>
			<VSCodeDataGrid className="flex-grow min-h-0">
				<VSCodeDataGridRow rowType="header">
					<VSCodeDataGridCell cellType="columnheader" gridColumn="1">
						Date &amp; Time
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="2">
						Task ID
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="3">
						Provider/Model
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="4">
						Task Snippet
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="5">
						Tokens
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="6">
						Cost
					</VSCodeDataGridCell>
				</VSCodeDataGridRow>
				{sortedHistory.map((entry) => (
					<VSCodeDataGridRow key={entry.timestamp}>
						<VSCodeDataGridCell gridColumn="1">
							{new Date(entry.timestamp).toLocaleString()} {/* Updated format */}
						</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="2" title={entry.taskId}>
							{/* Show only last 6 chars of Task ID for brevity */}
							...{entry.taskId.slice(-6)}
						</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="3">
							{entry.provider}/{entry.model}
						</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="4" title={entry.taskSnippet}>
							{entry.taskSnippet}
						</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="5">
							{(entry.inputTokens + entry.outputTokens).toLocaleString()}
						</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="6">${entry.cost?.toFixed(4) || "N/A"}</VSCodeDataGridCell>
					</VSCodeDataGridRow>
				))}
			</VSCodeDataGrid>
		</div>
	)
}

export default memo(ApiRequestHistoryTable)
