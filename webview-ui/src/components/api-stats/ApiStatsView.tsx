import React, { useState, useEffect, useMemo } from "react"
import { VSCodeProgressRing, VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { ApiRequestHistoryEntry } from "@shared/ClineAccount" // Corrected import path
import { vscode } from "../../utils/vscode"
import ApiUsageChart from "./ApiUsageChart"
import ApiRequestHistoryTable from "./ApiRequestHistoryTable"
import ApiTaskSummaryTable from "./ApiTaskSummaryTable"
import { calculateTaskSummaries, TaskSummaryEntry } from "../../utils/apiHistoryUtils" // Corrected import path and added TaskSummaryEntry

interface ApiStatsViewProps {
	onDone: () => void
}

const ApiStatsView: React.FC<ApiStatsViewProps> = ({ onDone }) => {
	const [history, setHistory] = useState<ApiRequestHistoryEntry[] | null>(null)
	const [loading, setLoading] = useState(true)
	const [selectedWorkspace, setSelectedWorkspace] = useState<string>("all")

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

	// Get unique workspace names from the full history
	const uniqueWorkspaces = useMemo(() => {
		if (!history) return ["all"]
		const workspaces = new Set(history.map((entry) => entry.workspace || "Unknown")) // Group undefined/null as 'Unknown'
		return ["all", ...Array.from(workspaces)]
	}, [history])

	// Filter history based on selected workspace
	const filteredHistory = useMemo(() => {
		if (!history) return []
		if (selectedWorkspace === "all") return history
		return history.filter((entry) => (entry.workspace || "Unknown") === selectedWorkspace)
	}, [history, selectedWorkspace])

	// Recalculate task summaries based on filtered history
	const taskSummaries: TaskSummaryEntry[] = useMemo(() => {
		return calculateTaskSummaries(filteredHistory)
	}, [filteredHistory])

	// Export Function
	const exportData = (formatType: "json" | "csv") => {
		if (filteredHistory.length === 0) return

		let dataString: string
		let mimeType: string
		let filename: string
		const dataToExport = filteredHistory // Export the filtered raw history

		if (formatType === "json") {
			dataString = JSON.stringify(dataToExport, null, 2)
			mimeType = "application/json"
			filename = "cline-api-history.json"
		} else {
			// CSV
			const headers = [
				"Timestamp",
				"Workspace",
				"Provider",
				"Model",
				"Task ID",
				"Task Snippet",
				"Input Tokens",
				"Output Tokens",
				"Cost",
			]
			const rows = dataToExport.map((entry) => [
				entry.timestamp,
				entry.workspace || "Unknown",
				entry.provider,
				entry.model,
				entry.taskId,
				`"${(entry.taskSnippet || "").replace(/"/g, '""')}"`, // Escape double quotes
				entry.inputTokens,
				entry.outputTokens,
				entry.cost || 0,
			])
			dataString = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n")
			mimeType = "text/csv;charset=utf-8;"
			filename = "cline-api-history.csv"
		}

		const blob = new Blob([dataString], { type: mimeType })
		const link = document.createElement("a")
		const url = URL.createObjectURL(blob)
		link.setAttribute("href", url)
		link.setAttribute("download", filename)
		link.style.visibility = "hidden"
		document.body.appendChild(link)
		link.click()
		document.body.removeChild(link)
		URL.revokeObjectURL(url)
	}

	return (
		<div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
			{/* Header with Title, Filters, Export, and Close */}
			<div
				style={{
					padding: "1rem",
					borderBottom: "1px solid var(--vscode-editorGroupHeader-tabsBorder)",
					display: "flex",
					alignItems: "center",
					flexWrap: "wrap", // Allow wrapping on smaller screens
					gap: "1rem", // Add gap between items
				}}>
				<h2 style={{ marginRight: "auto" }}>API Usage Statistics</h2> {/* Push title left */}
				{/* Workspace Filter */}
				{!loading && history && history.length > 0 && (
					<div className="flex items-center gap-1">
						<label htmlFor="workspace-select-main" className="text-xs">
							Workspace:
						</label>
						<VSCodeDropdown
							id="workspace-select-main"
							value={selectedWorkspace}
							onChange={(e: any) => setSelectedWorkspace(e.target.value)}>
							{uniqueWorkspaces.map((workspace) => (
								<VSCodeOption key={workspace} value={workspace}>
									{workspace === "all" ? "All Workspaces" : workspace}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</div>
				)}
				{/* Export Buttons */}
				{!loading && history && history.length > 0 && (
					<div className="flex gap-2">
						<VSCodeButton
							appearance="secondary"
							onClick={() => exportData("json")}
							disabled={filteredHistory.length === 0}>
							Export JSON
						</VSCodeButton>
						<VSCodeButton
							appearance="secondary"
							onClick={() => exportData("csv")}
							disabled={filteredHistory.length === 0}>
							Export CSV
						</VSCodeButton>
					</div>
				)}
				{/* Close Button */}
				<VSCodeButton appearance="secondary" onClick={onDone}>
					Close
				</VSCodeButton>
			</div>

			{/* Content Area */}
			{loading ? (
				<div style={{ display: "flex", justifyContent: "center", alignItems: "center", flexGrow: 1 }}>
					<VSCodeProgressRing />
				</div>
			) : filteredHistory && filteredHistory.length > 0 ? (
				<div style={{ flexGrow: 1, overflowY: "auto", padding: "1rem" }}>
					{/* Pass filtered data to child components */}
					<ApiUsageChart historyData={filteredHistory} />
					<ApiTaskSummaryTable isLoading={loading} taskSummaryData={taskSummaries} /> {/* Already uses filtered data */}
					<ApiRequestHistoryTable isLoading={loading} historyData={filteredHistory} />
				</div>
			) : (
				<div style={{ display: "flex", justifyContent: "center", alignItems: "center", flexGrow: 1, padding: "1rem" }}>
					<p>
						{history && history.length > 0
							? "No API request history found for the selected workspace."
							: "No API request history found."}
					</p>
				</div>
			)}
		</div>
	)
}

export default ApiStatsView
