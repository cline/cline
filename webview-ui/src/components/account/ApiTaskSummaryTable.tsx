import { VSCodeDataGrid, VSCodeDataGridCell, VSCodeDataGridRow } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"

export type TaskSummaryEntry = {
	taskId: string
	firstTimestamp: number
	taskSnippet: string
	totalRequests: number
	totalTokens: number
	totalCost: number
}

type ApiTaskSummaryTableProps = {
	isLoading: boolean
	taskSummaryData: TaskSummaryEntry[]
}

const ApiTaskSummaryTable = ({ isLoading, taskSummaryData }: ApiTaskSummaryTableProps) => {
	if (isLoading) {
		return <div className="text-[var(--vscode-descriptionForeground)]">Loading...</div>
	}

	if (!taskSummaryData || taskSummaryData.length === 0) {
		return <div className="text-[var(--vscode-descriptionForeground)]">No task history available.</div>
	}

	// Sort by timestamp descending (most recent task first)
	const sortedTasks = [...taskSummaryData].sort((a, b) => b.firstTimestamp - a.firstTimestamp)

	return (
		<div className="flex flex-col flex-grow min-h-0 mb-4">
			<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-1">TASK SUMMARY</div>
			<VSCodeDataGrid className="flex-grow min-h-0">
				<VSCodeDataGridRow rowType="header">
					<VSCodeDataGridCell cellType="columnheader" gridColumn="1">
						Date &amp; Time
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="2">
						Task ID
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="3">
						Task Snippet
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="4">
						Requests
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="5">
						Tokens
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="6">
						Cost
					</VSCodeDataGridCell>
				</VSCodeDataGridRow>
				{sortedTasks.map((task) => (
					<VSCodeDataGridRow key={task.taskId}>
						<VSCodeDataGridCell gridColumn="1">{new Date(task.firstTimestamp).toLocaleString()}</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="2" title={task.taskId}>
							...{task.taskId.slice(-6)}
						</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="3" title={task.taskSnippet}>
							{task.taskSnippet}
						</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="4">{task.totalRequests}</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="5">{task.totalTokens.toLocaleString()}</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="6">${task.totalCost.toFixed(4)}</VSCodeDataGridCell>
					</VSCodeDataGridRow>
				))}
			</VSCodeDataGrid>
		</div>
	)
}

export default memo(ApiTaskSummaryTable)
