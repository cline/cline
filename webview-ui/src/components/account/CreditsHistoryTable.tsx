import type { PaymentTransaction, UsageTransaction } from "@shared/ClineAccount"
import { VSCodeDataGrid, VSCodeDataGridCell, VSCodeDataGridRow } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { formatDollars, formatTimestamp } from "@/utils/format"
import { TabButton } from "../mcp/configuration/McpConfigurationView"

interface CreditsHistoryTableProps {
	isLoading: boolean
	usageData: UsageTransaction[]
	paymentsData: PaymentTransaction[]
	showPayments?: boolean
}

const CreditsHistoryTable = ({ isLoading, usageData, paymentsData, showPayments }: CreditsHistoryTableProps) => {
	const [activeTab, setActiveTab] = useState<"usage" | "payments">("usage")
	const { t } = useTranslation("common")

	return (
		<div className="flex flex-col grow h-full">
			{/* Tabs container */}
			<div className="flex border-b border-(--vscode-panel-border)">
				<TabButton isActive={activeTab === "usage"} onClick={() => setActiveTab("usage")}>
					{t("account.credit.usage_history")}
				</TabButton>
				{showPayments && (
					<TabButton isActive={activeTab === "payments"} onClick={() => setActiveTab("payments")}>
						{t("account.credit.payments_history")}
					</TabButton>
				)}
			</div>

			{/* Content container */}
			<div className="mt-[15px] mb-[0px] rounded-md overflow-auto grow">
				{isLoading ? (
					<div className="flex justify-center items-center p-4">
						<div className="text-(--vscode-descriptionForeground)">{t("account.credit.loading")}</div>
					</div>
				) : (
					<>
						{activeTab === "usage" &&
							(usageData.length > 0 ? (
								<VSCodeDataGrid>
									<VSCodeDataGridRow row-type="header">
										<VSCodeDataGridCell cell-type="columnheader" grid-column="1">
											{t("account.credit.date")}
										</VSCodeDataGridCell>
										<VSCodeDataGridCell cell-type="columnheader" grid-column="2">
											{t("account.credit.model")}
										</VSCodeDataGridCell>
										<VSCodeDataGridCell cell-type="columnheader" grid-column="3">
											{t("account.credit.credits_used")}
										</VSCodeDataGridCell>
									</VSCodeDataGridRow>

									{usageData.map((row, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: use index as key
										<VSCodeDataGridRow key={index}>
											<VSCodeDataGridCell grid-column="1">
												{formatTimestamp(row.createdAt)}
											</VSCodeDataGridCell>
											<VSCodeDataGridCell grid-column="2">{`${row.aiModelName}`}</VSCodeDataGridCell>
											{/* <VSCodeDataGridCell grid-column="3">{`${row.promptTokens} → ${row.completionTokens}`}</VSCodeDataGridCell> */}
											<VSCodeDataGridCell grid-column="3">{`$${Number(row.creditsUsed / 1000000).toFixed(4)}`}</VSCodeDataGridCell>
										</VSCodeDataGridRow>
									))}
								</VSCodeDataGrid>
							) : (
								<div className="flex justify-center items-center p-4">
									<div className="text-(--vscode-descriptionForeground)">
										{t("account.credit.no_usage_history")}
									</div>
								</div>
							))}

						{showPayments &&
							activeTab === "payments" &&
							(paymentsData.length > 0 ? (
								<VSCodeDataGrid>
									<VSCodeDataGridRow row-type="header">
										<VSCodeDataGridCell cell-type="columnheader" grid-column="1">
											{t("account.credit.date")}
										</VSCodeDataGridCell>
										<VSCodeDataGridCell cell-type="columnheader" grid-column="2">
											{t("account.credit.total_cost")}
										</VSCodeDataGridCell>
										<VSCodeDataGridCell cell-type="columnheader" grid-column="3">
											{t("account.credit.credits")}
										</VSCodeDataGridCell>
									</VSCodeDataGridRow>

									{paymentsData.map((row, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: use index as key
										<VSCodeDataGridRow key={index}>
											<VSCodeDataGridCell grid-column="1">{formatTimestamp(row.paidAt)}</VSCodeDataGridCell>
											<VSCodeDataGridCell grid-column="2">{`$${formatDollars(row.amountCents)}`}</VSCodeDataGridCell>
											<VSCodeDataGridCell grid-column="3">{`${row.credits}`}</VSCodeDataGridCell>
										</VSCodeDataGridRow>
									))}
								</VSCodeDataGrid>
							) : (
								<div className="flex justify-center items-center p-4">
									<div className="text-(--vscode-descriptionForeground)">
										{t("account.credit.no_payment_history")}
									</div>
								</div>
							))}
					</>
				)}
			</div>
		</div>
	)
}

export default CreditsHistoryTable
