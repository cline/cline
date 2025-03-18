import { VSCodeDataGrid, VSCodeDataGridRow, VSCodeDataGridCell } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { TabButton } from "../mcp/McpView"
import type { PaymentTransaction, UsageTransaction } from "../../../../src/services/account/ClineAccountService"

interface CreditsHistoryTableProps {
	isLoading: boolean
	usageData: UsageTransaction[]
	paymentsData: PaymentTransaction[]
}

const CreditsHistoryTable = ({ isLoading, usageData, paymentsData }: CreditsHistoryTableProps) => {
	const [activeTab, setActiveTab] = useState<"usage" | "payments">("usage")

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
							<>
								{usageData.length > 0 ? (
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
								) : (
									<div className="flex justify-center items-center p-4">
										<div className="text-[var(--vscode-descriptionForeground)]">No usage history</div>
									</div>
								)}
							</>
						)}

						{activeTab === "payments" && (
							<>
								{paymentsData.length > 0 ? (
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
								) : (
									<div className="flex justify-center items-center p-4">
										<div className="text-[var(--vscode-descriptionForeground)]">No payment history</div>
									</div>
								)}
							</>
						)}
					</>
				)}
			</div>
		</div>
	)
}

export default CreditsHistoryTable
