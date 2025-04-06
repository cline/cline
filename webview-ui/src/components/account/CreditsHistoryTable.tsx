import { useState, useMemo } from "react"
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination, Spinner } from "@heroui/react"
import { TabButton } from "../mcp/configuration/McpConfigurationView"
import { UsageTransaction, PaymentTransaction } from "@shared/ClineAccount"
import { formatDollars, formatTimestamp } from "@/utils/format"

interface CreditsHistoryTableProps {
	isLoading: boolean
	usageData: UsageTransaction[]
	paymentsData: PaymentTransaction[]
}

const CreditsHistoryTable = ({ isLoading, usageData, paymentsData }: CreditsHistoryTableProps) => {
	const [activeTab, setActiveTab] = useState<"usage" | "payments">("usage")
	const [usagePage, setUsagePage] = useState(1)
	const [paymentsPage, setPaymentsPage] = useState(1)
	const rowsPerPage = 5

	// Define columns for usage table
	const usageColumns = [
		{
			key: "date",
			label: "Date",
		},
		{
			key: "model",
			label: "Model",
		},
		{
			key: "credits",
			label: "Credits Used",
		},
	]

	// Define columns for payments table
	const paymentsColumns = [
		{
			key: "date",
			label: "Date",
		},
		{
			key: "totalCost",
			label: "Total Cost",
		},
		{
			key: "credits",
			label: "Credits",
		},
	]

	// Calculate pages for both tables
	const usagePages = Math.ceil(usageData.length / rowsPerPage)
	const paymentsPages = Math.ceil(paymentsData.length / rowsPerPage)

	// Prepare data for usage table with pagination
	const usageItems = useMemo(() => {
		const start = (usagePage - 1) * rowsPerPage
		const end = start + rowsPerPage

		return usageData.slice(start, end).map((row, index) => ({
			key: index.toString(),
			date: formatTimestamp(row.spentAt),
			model: `${row.modelProvider}/${row.model}`,
			credits: `$${Number(row.credits).toFixed(7)}`,
		}))
	}, [usagePage, usageData])

	// Prepare data for payments table with pagination
	const paymentsItems = useMemo(() => {
		const start = (paymentsPage - 1) * rowsPerPage
		const end = start + rowsPerPage

		return paymentsData.slice(start, end).map((row, index) => ({
			key: index.toString(),
			date: formatTimestamp(row.paidAt),
			totalCost: `$${formatDollars(parseInt(row.amountCents))}`,
			credits: `$${row.credits}`,
		}))
	}, [paymentsPage, paymentsData])

	return (
		<div className="flex flex-col flex-grow h-full">
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
			<div className="mt-4">
				{activeTab === "usage" && (
					<Table
						removeWrapper
						aria-label="Usage history table"
						bottomContent={
							usageData.length > 0 && (
								<div className="flex w-full justify-center">
									<Pagination
										isCompact
										showControls
										showShadow
										page={usagePage}
										total={usagePages}
										onChange={(page) => setUsagePage(page)}
										classNames={{
											item: "bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]",
											cursor: "bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]",
										}}
									/>
								</div>
							)
						}>
						<TableHeader columns={usageColumns}>
							{(column) => <TableColumn key={column.key}>{column.label}</TableColumn>}
						</TableHeader>
						<TableBody
							items={usageItems}
							isLoading={isLoading}
							loadingContent={<Spinner />}
							emptyContent={!isLoading && usageData.length === 0 && "No usage history"}>
							{(item) => (
								<TableRow key={item.key}>
									{(columnKey) => <TableCell>{item[columnKey as keyof typeof item]}</TableCell>}
								</TableRow>
							)}
						</TableBody>
					</Table>
				)}

				{activeTab === "payments" && (
					<Table
						removeWrapper
						aria-label="Payments history table"
						bottomContent={
							paymentsData.length > 0 && (
								<div className="flex w-full justify-center">
									<Pagination
										isCompact
										showControls
										showShadow
										page={paymentsPage}
										total={paymentsPages}
										onChange={(page) => setPaymentsPage(page)}
										classNames={{
											item: "bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]",
											cursor: "bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]",
										}}
									/>
								</div>
							)
						}>
						<TableHeader columns={paymentsColumns}>
							{(column) => <TableColumn key={column.key}>{column.label}</TableColumn>}
						</TableHeader>
						<TableBody
							items={paymentsItems}
							isLoading={isLoading}
							loadingContent={<Spinner />}
							emptyContent={!isLoading && paymentsData.length === 0 && "No payment history"}>
							{(item) => (
								<TableRow key={item.key}>
									{(columnKey) => <TableCell>{item[columnKey as keyof typeof item]}</TableCell>}
								</TableRow>
							)}
						</TableBody>
					</Table>
				)}
			</div>
		</div>
	)
}

export default CreditsHistoryTable
