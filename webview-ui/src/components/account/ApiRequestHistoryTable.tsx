import { ApiRequestHistoryEntry } from "@shared/ClineAccount"
import { VSCodeDataGrid, VSCodeDataGridRow, VSCodeDataGridCell } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"

type ApiRequestHistoryTableProps = {
	isLoading: boolean
	historyData: ApiRequestHistoryEntry[]
}

const ApiRequestHistoryTable = ({ isLoading, historyData }: ApiRequestHistoryTableProps) => {
	if (isLoading) {
		return <div className="text-[var(--vscode-descriptionForeground)]">Loading...</div>
	}

	return (
		<div className="flex flex-col flex-grow min-h-0">
			<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-3">API REQUEST HISTORY</div>
			<VSCodeDataGrid className="flex-grow min-h-0">
				<VSCodeDataGridRow rowType="header">
					<VSCodeDataGridCell cellType="columnheader" gridColumn="1">
						Date
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="2">
						Provider/Model
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="3">
						Task
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="4">
						Tokens
					</VSCodeDataGridCell>
					<VSCodeDataGridCell cellType="columnheader" gridColumn="5">
						Cost
					</VSCodeDataGridCell>
				</VSCodeDataGridRow>
				{historyData.map((entry) => (
					<VSCodeDataGridRow key={entry.timestamp}>
						<VSCodeDataGridCell gridColumn="1">{new Date(entry.timestamp).toLocaleDateString()}</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="2">
							{entry.provider}/{entry.model}
						</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="3" title={entry.taskSnippet}>
							{entry.taskSnippet}
						</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="4">{entry.inputTokens + entry.outputTokens}</VSCodeDataGridCell>
						<VSCodeDataGridCell gridColumn="5">${entry.cost?.toFixed(4) || "N/A"}</VSCodeDataGridCell>
					</VSCodeDataGridRow>
				))}
			</VSCodeDataGrid>
		</div>
	)
}

export default memo(ApiRequestHistoryTable)
