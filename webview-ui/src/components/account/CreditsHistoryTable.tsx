import type { PaymentTransaction, UsageTransaction } from "@shared/ClineAccount"
import { VSCodeDataGrid, VSCodeDataGridCell, VSCodeDataGridRow } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLanguage } from "@/hooks/useLanguage"
import { formatDollars, formatTimestamp } from "@/utils/format"
import { TabButton } from "../mcp/configuration/McpConfigurationView"

interface CreditsHistoryTableProps {
	isLoading: boolean
	usageData: UsageTransaction[]
	paymentsData: PaymentTransaction[]
	showPayments?: boolean
}

const CreditsHistoryTable = memo(({ isLoading, usageData, paymentsData, showPayments }: CreditsHistoryTableProps) => {
	const { t } = useTranslation()
	useLanguage()
	const [activeTab, setActiveTab] = useState<"usage" | "payments">("usage")

	return (
		<div className="flex flex-col grow h-full">
			{/* Tabs container */}
			<div className="flex border-b border-(--vscode-panel-border)">
				<TabButton isActive={activeTab === "usage"} onClick={() => setActiveTab("usage")}>
					{t("account.usageHistory")}
				</TabButton>
				{showPayments && (
					<TabButton isActive={activeTab === "payments"} onClick={() => setActiveTab("payments")}>
						{t("account.paymentsHistory")}
					</TabButton>
				)}
			</div>

			{/* Content container */}
			<div className="mt-[15px] mb-[0px] rounded-md overflow-auto grow">
				{isLoading ? (
					<div className="flex justify-center items-center p-4">
						<div className="text-(--vscode-descriptionForeground)">{t("account.loading")}</div>
					</div>
				) : (
					<>
						{activeTab === "usage" &&
							(usageData.length > 0 ? (
								<VSCodeDataGrid>
									<VSCodeDataGridRow row-type="header">
										<VSCodeDataGridCell cell-type="columnheader" grid-column="1">
											{t("account.date")}
										</VSCodeDataGridCell>
										<VSCodeDataGridCell cell-type="columnheader" grid-column="2">
											{t("account.model")}
										</VSCodeDataGridCell>
										{/* <VSCodeDataGridCell cell-type="columnheader" grid-column="3">
												Tokens Used
											</VSCodeDataGridCell> */}
										<VSCodeDataGridCell cell-type="columnheader" grid-column="3">
											{t("account.creditsUsed")}
										</VSCodeDataGridCell>
									</VSCodeDataGridRow>

									{usageData.map((row, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: use index as key
										<VSCodeDataGridRow key={index}>
											<VSCodeDataGridCell grid-column="1">
												{formatTimestamp(row.createdAt)}
											</VSCodeDataGridCell>
											<VSCodeDataGridCell grid-column="2">
												{row.operation === "web_search"
													? t("account.webSearch")
													: row.operation === "web_fetch"
														? t("account.webFetch")
														: row.operation === "search_chat_completion"
															? t("account.webFetchLLM")
															: row.aiModelName}
											</VSCodeDataGridCell>
											{/* <VSCodeDataGridCell grid-column="3">{`${row.promptTokens} → ${row.completionTokens}`}</VSCodeDataGridCell> */}
											<VSCodeDataGridCell grid-column="3">{`$${Number(row.creditsUsed / 1000000).toFixed(4)}`}</VSCodeDataGridCell>
										</VSCodeDataGridRow>
									))}
								</VSCodeDataGrid>
							) : (
								<div className="flex justify-center items-center p-4">
									<div className="text-(--vscode-descriptionForeground)">{t("account.noUsageHistory")}</div>
								</div>
							))}

						{showPayments &&
							activeTab === "payments" &&
							(paymentsData.length > 0 ? (
								<VSCodeDataGrid>
									<VSCodeDataGridRow row-type="header">
										<VSCodeDataGridCell cell-type="columnheader" grid-column="1">
											{t("account.date")}
										</VSCodeDataGridCell>
										<VSCodeDataGridCell cell-type="columnheader" grid-column="2">
											{t("account.totalCost")}
										</VSCodeDataGridCell>
										<VSCodeDataGridCell cell-type="columnheader" grid-column="3">
											{t("account.credits")}
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
									<div className="text-(--vscode-descriptionForeground)">{t("account.noPaymentHistory")}</div>
								</div>
							))}
					</>
				)}
			</div>
		</div>
	)
})

export default CreditsHistoryTable
