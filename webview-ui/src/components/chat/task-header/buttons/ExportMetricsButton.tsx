import { DetailedReqMetrics, getDetailedApiMetrics } from "@shared/getApiMetrics"
import { ChevronDown, Download } from "lucide-react"
import React, { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"

interface ExportMetricsButtonProps {
	className?: string
}

const ExportMetricsButton: React.FC<ExportMetricsButtonProps> = ({ className }) => {
	const [isOpen, setIsOpen] = useState(false)
	const { clineMessages } = useExtensionState()

	const handleExport = (format: "csv" | "json") => {
		const detailed = getDetailedApiMetrics(clineMessages)
		let content: string
		let filename: string
		let mimeType: string

		if (format === "json") {
			content = JSON.stringify(detailed, null, 2)
			filename = `chat-metrics-${Date.now()}.json`
			mimeType = "application/json"
		} else {
			// CSV
			let csv = "Req#,Tokens In,Tokens Out,Cache Writes,Cache Reads,Cost,Cumulative In,Cumulative Out,Cumulative Cost\n"
			detailed.perReq.forEach((req: DetailedReqMetrics) => {
				csv += `${req.reqIndex},${req.tokensIn},${req.tokensOut},${req.cacheWrites},${req.cacheReads},${req.cost.toFixed(4)},${req.cumulativeTokensIn},${req.cumulativeTokensOut},${req.cumulativeCost.toFixed(4)}\n`
			})
			csv += `\nTotals:${detailed.totals.totalTokensIn},${detailed.totals.totalTokensOut},${detailed.totals.totalCacheWrites || 0},${detailed.totals.totalCacheReads || 0},${detailed.totals.totalCost.toFixed(4)}`
			content = csv
			filename = `chat-metrics-${Date.now()}.csv`
			mimeType = "text/csv"
		}

		const blob = new Blob([content], { type: mimeType })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = filename
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
		setIsOpen(false)
	}

	return (
		<div className="relative">
			<button
				className={cn(
					"flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent hover:text-accent-foreground",
					className,
				)}
				onClick={() => setIsOpen(!isOpen)}>
				<Download size={14} />
				Export
				<ChevronDown className={cn("transition-transform", { "rotate-180": isOpen })} size={14} />
			</button>
			{isOpen && (
				<div className="absolute right-0 top-full mt-1 bg-background border rounded shadow-lg z-50 min-w-[100px]">
					<button
						className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground text-sm"
						onClick={() => handleExport("csv")}>
						CSV
					</button>
					<button
						className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground text-sm border-t"
						onClick={() => handleExport("json")}>
						JSON
					</button>
				</div>
			)}
		</div>
	)
}

export default ExportMetricsButton
