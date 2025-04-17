import { ApiRequestHistoryEntry } from "@shared/ClineAccount"
import { VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import {
	addDays,
	addHours,
	addMinutes,
	addMonths,
	addWeeks,
	endOfDay,
	endOfHour,
	endOfMonth,
	endOfWeek,
	format,
	isWithinInterval,
	parseISO,
	startOfDay,
	startOfHour,
	startOfMinute,
	startOfMonth,
	startOfWeek,
	subDays,
	subHours,
	subMonths,
	subWeeks,
} from "date-fns"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

type Granularity = "15min" | "hourly" | "daily" | "weekly" | "monthly"
type ValueType = "requests" | "tokens" | "cost"
type TimeRange = "lastHour" | "last6Hours" | "lastDay" | "lastWeek" | "lastMonth" | "custom"

type ChartDataPoint = {
	timestamp: number // Start of the interval
	label: string
	requests: number
	tokens: number
	cost: number
}

type ApiUsageChartProps = {
	historyData: ApiRequestHistoryEntry[]
}

const DATE_FORMAT = "yyyy-MM-dd"
const DEFAULT_TIME_RANGE: TimeRange = "lastDay" // Changed default to Last 24 Hours

// Helper to calculate date range based on selection
const calculateDateRange = (range: TimeRange): { start: Date; end: Date } => {
	const now = new Date()
	switch (range) {
		case "lastHour":
			return { start: subHours(now, 1), end: now }
		case "last6Hours":
			return { start: subHours(now, 6), end: now }
		case "lastDay": // Changed to Last 24 Hours
			return { start: subHours(now, 24), end: now }
		case "lastWeek":
			return { start: startOfDay(subWeeks(now, 1)), end: endOfDay(now) }
		case "lastMonth":
			return { start: startOfDay(subMonths(now, 1)), end: endOfDay(now) }
		case "custom":
		default:
			// Should not happen if state is managed correctly, but return a default
			return { start: startOfDay(subWeeks(now, 1)), end: endOfDay(now) }
	}
}

// Helper to format large numbers (k, M)
const formatNumber = (num: number): string => {
	if (num >= 1000000) {
		return `${(num / 1000000).toFixed(1)}M`
	}
	if (num >= 1000) {
		return `${(num / 1000).toFixed(1)}k`
	}
	return num.toString()
}

const ApiUsageChart = ({ historyData }: ApiUsageChartProps) => {
	// Set initial granularity based on the default time range
	const getInitialGranularity = (range: TimeRange): Granularity => {
		switch (range) {
			case "lastHour":
				return "15min"
			case "last6Hours":
			case "lastDay":
				return "hourly"
			case "lastWeek":
			case "lastMonth":
			default:
				return "daily"
		}
	}
	const [granularity, setGranularity] = useState<Granularity>(getInitialGranularity(DEFAULT_TIME_RANGE))
	const [valueType, setValueType] = useState<ValueType>("requests")
	const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE)
	const [selectedProvider, setSelectedProvider] = useState<string>("all")
	// Initialize dates based on default time range
	const initialRange = calculateDateRange(DEFAULT_TIME_RANGE)
	const [startDate, setStartDate] = useState<Date>(initialRange.start)
	const [endDate, setEndDate] = useState<Date>(initialRange.end)

	const chartContainerRef = useRef<HTMLDivElement>(null)

	// Update dates when timeRange changes
	useEffect(() => {
		if (timeRange !== "custom") {
			const { start, end } = calculateDateRange(timeRange)
			setStartDate(start)
			setEndDate(end)
		}
	}, [timeRange])

	const handleTimeRangeChange = (e: any) => {
		const newRange = e.target.value as TimeRange
		setTimeRange(newRange)
		// Auto-adjust granularity based on the new time range
		if (newRange !== "custom") {
			let newGranularity: Granularity = "daily" // Default fallback
			switch (newRange) {
				case "lastHour":
					newGranularity = "15min"
					break
				case "last6Hours":
				case "lastDay":
					newGranularity = "hourly"
					break
				case "lastWeek":
				case "lastMonth":
					newGranularity = "daily"
					break
			}
			setGranularity(newGranularity)
		}
		// Dates will be updated by the useEffect hook
	}

	const handleStartDateChange = (e: any) => {
		if (timeRange !== "custom") return // Ignore if not custom range
		try {
			const date = parseISO(e.target.value)
			if (!isNaN(date.getTime())) {
				setStartDate(startOfDay(date))
			}
		} catch (error) {
			console.error("Invalid start date:", e.target.value)
		}
	}

	const handleEndDateChange = (e: any) => {
		if (timeRange !== "custom") return // Ignore if not custom range
		try {
			const date = parseISO(e.target.value)
			if (!isNaN(date.getTime())) {
				setEndDate(endOfDay(date))
			}
		} catch (error) {
			console.error("Invalid end date:", e.target.value)
		}
	}

	const uniqueProviders = useMemo(() => {
		const providers = new Set(historyData.map((entry) => entry.provider))
		return ["all", ...Array.from(providers)]
	}, [historyData])

	const aggregatedData = useMemo(() => {
		// Ensure start date is not after end date (only relevant for custom range)
		const effectiveStartDate = timeRange === "custom" && startDate > endDate ? endDate : startDate
		const effectiveEndDate = timeRange === "custom" && endDate < startDate ? startDate : endDate

		// 1. Filter by Provider
		const providerFilteredData =
			selectedProvider === "all" ? historyData : historyData.filter((entry) => entry.provider === selectedProvider)

		// 2. Filter by Date Range
		const dateFilteredData = providerFilteredData.filter((entry) =>
			isWithinInterval(new Date(entry.timestamp), { start: effectiveStartDate, end: effectiveEndDate }),
		)

		if (dateFilteredData.length === 0) return []

		// 3. Aggregate Data
		const dataMap = new Map<number, ChartDataPoint>()

		dateFilteredData.forEach((entry) => {
			const entryDate = new Date(entry.timestamp)
			let intervalStart: Date

			switch (granularity) {
				case "15min":
					const minutes = entryDate.getMinutes()
					const roundedMinutes = Math.floor(minutes / 15) * 15
					intervalStart = startOfMinute(entryDate)
					intervalStart.setMinutes(roundedMinutes, 0, 0)
					break
				case "hourly":
					intervalStart = startOfHour(entryDate)
					break
				case "daily":
					intervalStart = startOfDay(entryDate)
					break
				case "weekly":
					intervalStart = startOfWeek(entryDate, { weekStartsOn: 1 }) // Monday start
					break
				case "monthly":
					intervalStart = startOfMonth(entryDate)
					break
			}

			const timestampKey = intervalStart.getTime()
			if (!dataMap.has(timestampKey)) {
				let labelFormat: string
				switch (granularity) {
					case "15min":
						labelFormat = "MMM d, HH:mm"
						break
					case "hourly":
						labelFormat = "MMM d, HH:00"
						break
					case "daily":
						labelFormat = "MMM d"
						break
					case "weekly":
						labelFormat = "'Week of' MMM d"
						break
					case "monthly":
						labelFormat = "MMM yyyy"
						break
				}
				dataMap.set(timestampKey, {
					timestamp: timestampKey,
					label: format(intervalStart, labelFormat),
					requests: 0,
					tokens: 0,
					cost: 0,
				})
			}

			const point = dataMap.get(timestampKey)!
			point.requests += 1
			point.tokens += entry.inputTokens + entry.outputTokens
			point.cost += entry.cost || 0
		})

		// 4. Fill gaps and sort
		const result: ChartDataPoint[] = []
		let current = effectiveStartDate
		const end = effectiveEndDate

		// Adjust start time based on granularity to avoid unnecessary initial points
		switch (granularity) {
			case "15min": {
				const minutes = current.getMinutes()
				const roundedMinutes = Math.floor(minutes / 15) * 15
				current = startOfMinute(current)
				current.setMinutes(roundedMinutes, 0, 0)
				break
			}
			case "hourly":
				current = startOfHour(current)
				break
			case "daily":
				current = startOfDay(current)
				break
			case "weekly":
				current = startOfWeek(current, { weekStartsOn: 1 })
				break
			case "monthly":
				current = startOfMonth(current)
				break
		}

		while (current <= end) {
			let intervalStart: Date
			let nextIncrementFn: (date: Date) => Date

			switch (granularity) {
				case "15min":
					intervalStart = current // Already adjusted start
					nextIncrementFn = (d) => addMinutes(d, 15)
					break
				case "hourly":
					intervalStart = current // Already adjusted start
					nextIncrementFn = (d) => addHours(d, 1)
					break
				case "daily":
					intervalStart = current // Already adjusted start
					nextIncrementFn = (d) => addDays(d, 1)
					break
				case "weekly":
					intervalStart = current // Already adjusted start
					nextIncrementFn = (d) => addWeeks(d, 1)
					break
				case "monthly":
					intervalStart = current // Already adjusted start
					nextIncrementFn = (d) => addMonths(d, 1)
					break
			}

			const timestampKey = intervalStart.getTime()
			// Only add if the interval *starts* within the selected range
			// (This check might seem redundant now but kept for safety)
			if (intervalStart >= effectiveStartDate && intervalStart <= effectiveEndDate) {
				if (dataMap.has(timestampKey)) {
					result.push(dataMap.get(timestampKey)!)
				} else {
					// Add zero-value point for gaps
					let labelFormat: string
					switch (granularity) {
						case "15min":
							labelFormat = "MMM d, HH:mm"
							break
						case "hourly":
							labelFormat = "MMM d, HH:00"
							break
						case "daily":
							labelFormat = "MMM d"
							break
						case "weekly":
							labelFormat = "'Week of' MMM d"
							break
						case "monthly":
							labelFormat = "MMM yyyy"
							break
					}
					result.push({
						timestamp: timestampKey,
						label: format(intervalStart, labelFormat),
						requests: 0,
						tokens: 0,
						cost: 0,
					})
				}
			}

			// Move to the start of the next interval
			current = nextIncrementFn(intervalStart)
		}

		// Ensure unique points and sort finally by timestamp
		const uniqueResult = Array.from(new Map(result.map((item) => [item.timestamp, item])).values())
		const finalData = uniqueResult.sort((a, b) => a.timestamp - b.timestamp)
		return finalData
	}, [historyData, granularity, startDate, endDate, selectedProvider, timeRange]) // Added dependencies

	// Calculate summary stats based on the final aggregated data
	const summaryStats = useMemo(() => {
		return aggregatedData.reduce(
			(acc, point) => {
				acc.totalRequests += point.requests
				acc.totalTokens += point.tokens
				acc.totalCost += point.cost
				return acc
			},
			{ totalRequests: 0, totalTokens: 0, totalCost: 0 },
		)
	}, [aggregatedData])

	const yAxisLabel = useMemo(() => {
		switch (valueType) {
			case "requests":
				return "Requests"
			case "tokens":
				return "Tokens"
			case "cost":
				return "Cost ($)"
		}
	}, [valueType])

	const formatYAxisTick = (value: number) => {
		if (valueType === "cost") {
			return `$${value.toFixed(2)}`
		}
		return formatNumber(value) // Use helper for Y-axis ticks
	}

	const chartDataKey = valueType
	const isCustomRange = timeRange === "custom"

	return (
		<div className="flex flex-col flex-grow min-h-0 mb-4">
			<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-2">API USAGE CHART</div>
			{/* Controls */}
			<div className="flex gap-4 mb-2 items-end flex-wrap">
				<div>
					<label htmlFor="timerange-select" className="text-xs block mb-1">
						Time Range
					</label>
					<VSCodeDropdown id="timerange-select" value={timeRange} onChange={handleTimeRangeChange}>
						<VSCodeOption value="lastHour">Last Hour</VSCodeOption>
						<VSCodeOption value="last6Hours">Last 6 Hours</VSCodeOption>
						<VSCodeOption value="lastDay">Last 24 Hours</VSCodeOption> {/* Updated Label */}
						<VSCodeOption value="lastWeek">Last Week</VSCodeOption>
						<VSCodeOption value="lastMonth">Last Month</VSCodeOption>
						<VSCodeOption value="custom">Custom</VSCodeOption>
					</VSCodeDropdown>
				</div>
				<div>
					<label htmlFor="start-date" className="text-xs block mb-1">
						Start Date
					</label>
					<VSCodeTextField
						id="start-date"
						type={"date" as any}
						value={format(startDate, DATE_FORMAT)}
						onChange={handleStartDateChange}
						disabled={!isCustomRange} // Disable if not custom
						style={{ opacity: isCustomRange ? 1 : 0.5 }} // Visual cue
					/>
				</div>
				<div>
					<label htmlFor="end-date" className="text-xs block mb-1">
						End Date
					</label>
					<VSCodeTextField
						id="end-date"
						type={"date" as any}
						value={format(endDate, DATE_FORMAT)}
						onChange={handleEndDateChange}
						disabled={!isCustomRange} // Disable if not custom
						style={{ opacity: isCustomRange ? 1 : 0.5 }} // Visual cue
					/>
				</div>
				<div>
					<label htmlFor="granularity-select" className="text-xs block mb-1">
						Granularity
					</label>
					<VSCodeDropdown
						id="granularity-select"
						value={granularity}
						onChange={(e: any) => setGranularity(e.target.value)}>
						<VSCodeOption value="15min">15 Minutes</VSCodeOption>
						<VSCodeOption value="hourly">Hourly</VSCodeOption>
						<VSCodeOption value="daily">Daily</VSCodeOption>
						<VSCodeOption value="weekly">Weekly</VSCodeOption>
						<VSCodeOption value="monthly">Monthly</VSCodeOption>
					</VSCodeDropdown>
				</div>
				<div>
					<label htmlFor="valuetype-select" className="text-xs block mb-1">
						Value
					</label>
					<VSCodeDropdown id="valuetype-select" value={valueType} onChange={(e: any) => setValueType(e.target.value)}>
						<VSCodeOption value="requests">Requests</VSCodeOption>
						<VSCodeOption value="tokens">Tokens</VSCodeOption>
						<VSCodeOption value="cost">Cost</VSCodeOption>
					</VSCodeDropdown>
				</div>
				<div>
					<label htmlFor="provider-select" className="text-xs block mb-1">
						Provider
					</label>
					<VSCodeDropdown
						id="provider-select"
						value={selectedProvider}
						onChange={(e: any) => setSelectedProvider(e.target.value)}>
						{uniqueProviders.map((provider) => (
							<VSCodeOption key={provider} value={provider}>
								{provider === "all" ? "All Providers" : provider}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</div>
			</div>

			{/* Summary Stats */}
			<div className="text-xs text-[var(--vscode-descriptionForeground)] mb-3">
				Totals for selected period: <span className="font-semibold">{summaryStats.totalRequests.toLocaleString()}</span>{" "}
				Requests • <span className="font-semibold">{formatNumber(summaryStats.totalTokens)}</span> Tokens •{" "}
				<span className="font-semibold">${summaryStats.totalCost.toFixed(4)}</span> Cost
			</div>

			{/* Chart */}
			<div ref={chartContainerRef} className="flex-grow h-[250px]">
				{aggregatedData.length > 0 ? (
					<ResponsiveContainer width="100%" height="100%">
						<LineChart data={aggregatedData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
							<CartesianGrid strokeDasharray="3 3" stroke="var(--vscode-editorWidget-border)" />
							<XAxis
								dataKey="label"
								stroke="var(--vscode-foreground)"
								tick={{ fontSize: 10 }}
								// interval="preserveStartEnd" // Adjust interval based on data density if needed
							/>
							<YAxis
								stroke="var(--vscode-foreground)"
								tick={{ fontSize: 10 }}
								tickFormatter={formatYAxisTick}
								label={{
									value: yAxisLabel,
									angle: -90,
									position: "insideLeft",
									fill: "var(--vscode-foreground)",
									fontSize: 12,
									dy: 40, // Adjust position
								}}
								width={50} // Adjust width to fit label
							/>
							<Tooltip
								contentStyle={{
									backgroundColor: "var(--vscode-editorWidget-background)",
									borderColor: "var(--vscode-editorWidget-border)",
									color: "var(--vscode-foreground)",
									fontSize: "12px",
									borderRadius: "4px",
								}}
								formatter={(value: number, name: string) => {
									if (name === "cost") return [`$${value.toFixed(4)}`, yAxisLabel]
									if (name === "tokens") return [value.toLocaleString(), yAxisLabel]
									return [value.toLocaleString(), yAxisLabel]
								}}
							/>
							{/* <Legend wrapperStyle={{ fontSize: "12px" }} /> */}
							<Line
								type="monotone"
								dataKey={chartDataKey}
								name={yAxisLabel} // Use dynamic name for tooltip/legend
								stroke="var(--vscode-charts-blue)"
								strokeWidth={2}
								dot={false}
								activeDot={{ r: 6 }}
							/>
						</LineChart>
					</ResponsiveContainer>
				) : (
					<div className="flex items-center justify-center h-full text-[var(--vscode-descriptionForeground)]">
						No data available for the selected filters.
					</div>
				)}
			</div>
		</div>
	)
}

export default memo(ApiUsageChart)
