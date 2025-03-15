import { VSCodeDataGrid, VSCodeDataGridRow, VSCodeDataGridCell } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { TabButton } from "../mcp/McpView"

const CreditsHistoryTable = () => {
	const [activeTab, setActiveTab] = useState<"usage" | "payments">("usage")

	// Sample data for usage history
	const usageData = [
		{ timestamp: "03/12/25, 6:40 PM", model: "anthropic/claude-3.7-sonnet", tokensUsed: "120739", credit: "0.3594" },
		{ timestamp: "00", model: "00", tokensUsed: "00", credit: "00" },
		{ timestamp: "00", model: "00", tokensUsed: "00", credit: "00" },
		{ timestamp: "00", model: "00", tokensUsed: "00", credit: "00" },
	]

	// Sample data for payments history
	const paymentsData = [
		{ timestamp: "00", totalCost: "00", credits: "00" },
		{ timestamp: "00", totalCost: "00", credits: "00" },
		{ timestamp: "00", totalCost: "00", credits: "00" },
		{ timestamp: "00", totalCost: "00", credits: "00" },
	]

	return (
		<div className="flex flex-col">
			{/* Tabs container */}
			<div className="flex border-b border-[var(--vscode-panel-border)]">
				<TabButton isActive={activeTab === "usage"} onClick={() => setActiveTab("usage")}>
					USAGE HISTORY
				</TabButton>
				<TabButton isActive={activeTab === "payments"} onClick={() => setActiveTab("payments")}>
					PAYMENTS HISTORY
				</TabButton>
			</div>

			{/* Content container */}
			<div className="mt-[30px] rounded-md overflow-hidden">
				{activeTab === "usage" && (
					<VSCodeDataGrid>
						<VSCodeDataGridRow row-type="header">
							<VSCodeDataGridCell cell-type="columnheader" grid-column="1">
								Date
							</VSCodeDataGridCell>
							<VSCodeDataGridCell cell-type="columnheader" grid-column="2">
								Model
							</VSCodeDataGridCell>
							<VSCodeDataGridCell cell-type="columnheader" grid-column="3">
								Tokens Used
							</VSCodeDataGridCell>
							<VSCodeDataGridCell cell-type="columnheader" grid-column="4">
								Credits Used
							</VSCodeDataGridCell>
						</VSCodeDataGridRow>

						{usageData.map((row, index) => (
							<VSCodeDataGridRow key={index}>
								<VSCodeDataGridCell grid-column="1">{row.timestamp}</VSCodeDataGridCell>
								<VSCodeDataGridCell grid-column="2">{row.model}</VSCodeDataGridCell>
								<VSCodeDataGridCell grid-column="3">{row.tokensUsed}</VSCodeDataGridCell>
								<VSCodeDataGridCell grid-column="4">{row.credit}</VSCodeDataGridCell>
							</VSCodeDataGridRow>
						))}
					</VSCodeDataGrid>
				)}

				{activeTab === "payments" && (
					<VSCodeDataGrid>
						<VSCodeDataGridRow row-type="header">
							<VSCodeDataGridCell cell-type="columnheader" grid-column="1">
								Date
							</VSCodeDataGridCell>
							<VSCodeDataGridCell cell-type="columnheader" grid-column="2">
								Total Cost
							</VSCodeDataGridCell>
							<VSCodeDataGridCell cell-type="columnheader" grid-column="3">
								Credits
							</VSCodeDataGridCell>
						</VSCodeDataGridRow>

						{paymentsData.map((row, index) => (
							<VSCodeDataGridRow key={index}>
								<VSCodeDataGridCell grid-column="1">{row.timestamp}</VSCodeDataGridCell>
								<VSCodeDataGridCell grid-column="2">{row.totalCost}</VSCodeDataGridCell>
								<VSCodeDataGridCell grid-column="3">{row.credits}</VSCodeDataGridCell>
							</VSCodeDataGridRow>
						))}
					</VSCodeDataGrid>
				)}
			</div>
		</div>
	)
}

export default CreditsHistoryTable
