import { VSCodeDataGrid, VSCodeDataGridRow, VSCodeDataGridCell } from "@vscode/webview-ui-toolkit/react"
import { useState, useEffect } from "react"
import { TabButton } from "../mcp/McpView"
import { vscode } from "../../utils/vscode"

const CreditsHistoryTable = () => {
	const [activeTab, setActiveTab] = useState<"usage" | "payments">("usage")
	const [isLoading, setIsLoading] = useState<boolean>(true)

	// State for transaction data
	const [usageData, setUsageData] = useState<any[]>([])
	const [paymentsData, setPaymentsData] = useState<any[]>([])

	// Listen for transaction data updates from the extension
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "userCreditsUsage" && message.userCreditsUsage) {
				setUsageData(message.userCreditsUsage)
				if (activeTab === "usage") {
					setIsLoading(false)
				}
			} else if (message.type === "userCreditsPayments" && message.userCreditsPayments) {
				setPaymentsData(message.userCreditsPayments)
				if (activeTab === "payments") {
					setIsLoading(false)
				}
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [activeTab])

	// Fetch data when tab changes
	useEffect(() => {
		setIsLoading(true)
		vscode.postMessage({ type: "fetchUserCreditsData" })
	}, [activeTab])

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
				{isLoading ? (
					<div className="flex justify-center items-center p-4">
						<div className="text-[var(--vscode-descriptionForeground)]">Loading...</div>
					</div>
				) : (
					<>
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

								{usageData.length > 0 ? (
									usageData.map((row, index) => (
										<VSCodeDataGridRow key={index}>
											<VSCodeDataGridCell grid-column="1">{row.timestamp}</VSCodeDataGridCell>
											<VSCodeDataGridCell grid-column="2">{row.model}</VSCodeDataGridCell>
											<VSCodeDataGridCell grid-column="3">{row.tokensUsed}</VSCodeDataGridCell>
											<VSCodeDataGridCell grid-column="4">{row.credit}</VSCodeDataGridCell>
										</VSCodeDataGridRow>
									))
								) : (
									<VSCodeDataGridRow>
										<VSCodeDataGridCell grid-column="1" grid-column-span="4" className="text-center">
											No usage history
										</VSCodeDataGridCell>
									</VSCodeDataGridRow>
								)}
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

								{paymentsData.length > 0 ? (
									paymentsData.map((row, index) => (
										<VSCodeDataGridRow key={index}>
											<VSCodeDataGridCell grid-column="1">{row.timestamp}</VSCodeDataGridCell>
											<VSCodeDataGridCell grid-column="2">{row.totalCost}</VSCodeDataGridCell>
											<VSCodeDataGridCell grid-column="3">{row.credits}</VSCodeDataGridCell>
										</VSCodeDataGridRow>
									))
								) : (
									<VSCodeDataGridRow>
										<VSCodeDataGridCell grid-column="1" grid-column-span="3" className="text-center">
											No payment history
										</VSCodeDataGridCell>
									</VSCodeDataGridRow>
								)}
							</VSCodeDataGrid>
						)}
					</>
				)}
			</div>
		</div>
	)
}

export default CreditsHistoryTable
