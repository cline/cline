import { useEffect, useState } from "react"
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { CircleAlert, SquareArrowOutUpRight } from "lucide-react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { formatDateShort, formatLargeNumber, formatCost } from "@/utils/format"

interface DailyUsage {
	date: string // ISO date string
	taskCount: number
	tokenCount: number
	cost: number // in USD
}

interface UsageStats {
	days: DailyUsage[]
	totals: {
		tasks: number
		tokens: number
		cost: number
	}
}

interface UsagePreviewProps {
	onViewDetails: () => void
}

export const UsagePreview = ({ onViewDetails }: UsagePreviewProps) => {
	const { t } = useAppTranslation()
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [data, setData] = useState<UsageStats | null>(null)

	// Fetch usage data on mount
	useEffect(() => {
		setIsLoading(true)
		setError(null)

		// Request usage preview data from the extension
		vscode.postMessage({ type: "getUsagePreview" })

		// Listen for the response
		let timeoutId: ReturnType<typeof setTimeout> | null = null
		const handleMessage = (event: MessageEvent) => {
			const message = event.data

			if (message.type === "usagePreviewData") {
				// Clear timeout on success/error to avoid stale timeout flipping UI into error
				if (timeoutId) {
					clearTimeout(timeoutId)
				}

				if (message.error) {
					setError(message.error)
				} else if (message.data) {
					// Validate the data structure
					if (!message.data.days || !Array.isArray(message.data.days)) {
						setError(t("cloud:usagePreview.invalidDataFormat"))
					} else {
						setData(message.data)
					}
				}
				setIsLoading(false)
			}
		}

		window.addEventListener("message", handleMessage)

		// Clean up listener after 10 seconds (timeout)
		timeoutId = setTimeout(() => {
			if (isLoading) {
				setError(t("cloud:usagePreview.failedToLoad"))
				setIsLoading(false)
			}
		}, 10000)

		return () => {
			if (timeoutId) {
				clearTimeout(timeoutId)
			}
			window.removeEventListener("message", handleMessage)
		}
	}, []) // eslint-disable-line react-hooks/exhaustive-deps

	const getBarHeight = (cost: number): number => {
		if (!data || !data.days || data.days.length === 0) return 1
		const maxCost = Math.max(...data.days.map((d) => d.cost))
		if (!Number.isFinite(maxCost) || maxCost <= 0) return 1
		// Compute percentage first, then round; enforce minimum height for visibility
		return Math.max(1, Math.round((cost / maxCost) * 100))
	}

	// Retry loading
	const handleRetry = () => {
		setError(null)
		setIsLoading(true)
		vscode.postMessage({ type: "getUsagePreview" })
	}

	// Loading state
	if (isLoading) {
		return (
			<div
				className="cursor-pointer group rounded-lg bg-vscode-editor-background hover:bg-vscode-list-hoverBackground transition-colors relative"
				onClick={onViewDetails}>
				<div className="p-4">
					{/* Loading spinner centered in chart area */}
					<div className="h-20 flex items-center justify-center mb-3">
						<VSCodeProgressRing className="size-6" />
					</div>
				</div>
			</div>
		)
	}

	// Error state
	if (error || !data) {
		return (
			<div
				className="cursor-pointer group rounded-lg bg-vscode-editor-background hover:bg-vscode-list-hoverBackground transition-colors relative"
				onClick={handleRetry}>
				<div className="p-4">
					{/* Error message in chart area */}
					<div className="mb-3 text-vscode-descriptionForeground">
						<CircleAlert className="size-4 mb-2 text-vscode-muted-foreground" />
						<p className="text-xs font-mono font-bold">{t("cloud:usagePreview.couldNotLoadChart")}</p>
						<p className="text-xs font-mono">{error}</p>
						<p className="text-xs font-medium mt-1">{t("cloud:usagePreview.clickToRetry")}</p>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="cursor-pointer group rounded-lg bg-vscode-editor-background relative" onClick={onViewDetails}>
			<div className="p-4">
				{/* Chart with daily usage bars */}
				<div
					className="h-24 min-[450px]:h-40 rounded mb-3 flex items-end gap-1 pb-2"
					role="img"
					aria-label={t("cloud:usagePreview.costPastDays", { count: data.days.length })}>
					{data &&
						Array.isArray(data.days) &&
						data.days.map((day, index) => (
							<div key={index} className="w-full flex flex-col items-center justify-end h-full">
								<div
									className="w-full rounded-t-xs transition-all bg-vscode-button-background"
									style={{ height: `${getBarHeight(day.cost)}%` }}
									aria-label={`${formatDateShort(new Date(day.date).getTime())}: ${formatCost(day.cost)}`}
								/>
								<span className="text-[9px] h-[1em] hidden min-[300px]:block overflow-clip text-center text-muted-foreground mt-0.5">
									{formatDateShort(new Date(day.date).getTime())}
								</span>
							</div>
						))}
				</div>

				{/* Stats text */}
				<div className="flex flex-col justify-between text-sm min-[400px]:flex-row min-[450px]:items-center">
					<span className="flex items-center gap-1 text-vscode-descriptionForeground">
						{t("cloud:usagePreview.costPastDays", { count: data.days.length })}
					</span>
					<span className="text-vscode-foreground">
						{t("cloud:usagePreview.tasks", { count: data.totals.tasks })}
						<span> · </span>
						{t("cloud:usagePreview.tokens", { count: formatLargeNumber(data.totals.tokens) })}
						<span> · </span>
						{formatCost(data.totals.cost)}
					</span>
				</div>
			</div>

			{/* Hover overlay */}
			<div className="absolute inset-0 bg-vscode-editor-background/85 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
				<div className="flex items-center gap-2 text-vscode-foreground">
					<span>{t("cloud:usagePreview.seeMoreStats")}</span>
					<SquareArrowOutUpRight className="size-3" />
				</div>
			</div>
		</div>
	)
}
