import React, { useState, useEffect, useMemo } from "react"
import { VSCodeProgressRing, VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { ApiRequestHistoryEntry } from "@shared/ClineAccount" // Corrected import path
import { vscode } from "../../utils/vscode"
import ApiUsageChart from "../account/ApiUsageChart" // Temporarily keep path, will move later
import ApiRequestHistoryTable from "../account/ApiRequestHistoryTable" // Temporarily keep path, will move later
import ApiTaskSummaryTable from "../account/ApiTaskSummaryTable" // Temporarily keep path, will move later
import { calculateTaskSummaries, TaskSummaryEntry } from "../../utils/apiHistoryUtils" // Corrected import path and added TaskSummaryEntry

interface ApiStatsViewProps {
	onDone: () => void
}

const ApiStatsView: React.FC<ApiStatsViewProps> = ({ onDone }) => {
	const [history, setHistory] = useState<ApiRequestHistoryEntry[] | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		vscode.postMessage({ type: "getApiRequestHistory" })

		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "apiRequestHistory") {
				setHistory(message.history || [])
				setLoading(false)
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	const taskSummaries: TaskSummaryEntry[] = useMemo(() => {
		// Added type
		return history ? calculateTaskSummaries(history) : []
	}, [history])

	return (
		<div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
			<div
				style={{
					padding: "1rem",
					borderBottom: "1px solid var(--vscode-editorGroupHeader-tabsBorder)",
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}>
				<h2>API Usage Statistics</h2>
				<VSCodeButton appearance="secondary" onClick={onDone}>
					Close
				</VSCodeButton>
			</div>
			{loading ? (
				<div style={{ display: "flex", justifyContent: "center", alignItems: "center", flexGrow: 1 }}>
					<VSCodeProgressRing />
				</div>
			) : history && history.length > 0 ? (
				<div style={{ flexGrow: 1, overflowY: "auto", padding: "1rem" }}>
					{/* Corrected prop names and added isLoading */}
					<ApiUsageChart historyData={history!} /> {/* Added non-null assertion */}
					<ApiTaskSummaryTable isLoading={loading} taskSummaryData={taskSummaries} />
					<ApiRequestHistoryTable isLoading={loading} historyData={history!} /> {/* Added non-null assertion */}
				</div>
			) : (
				<div style={{ display: "flex", justifyContent: "center", alignItems: "center", flexGrow: 1 }}>
					<p>No API request history found.</p>
				</div>
			)}
		</div>
	)
}

export default ApiStatsView
