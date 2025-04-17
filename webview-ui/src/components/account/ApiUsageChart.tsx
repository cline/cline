import { ApiRequestHistoryEntry } from "@shared/ClineAccount"
import { VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import {
	addDays,
	addHours,
	addMinutes,
	addMonths,
	addWeeks,
	endOfDay,
	format,
	isWithinInterval,
	parseISO,
	startOfDay,
	startOfHour,
	startOfMinute,
	startOfMonth,
	startOfWeek,
	subDays,
} from "date-fns"
import { memo, useMemo, useRef, useState } from "react" // Added useEffect, useRef
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

type Granularity = "15min" | "hourly" | "daily" | "weekly" | "monthly"
type ValueType = "requests" | "tokens" | "cost"

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

const ApiUsageChart = ({ historyData }: ApiUsageChartProps) => {
	const [granularity, setGranularity] = useState<Granularity>("daily")
	const [valueType, setValueType] = useState<ValueType>("requests")
	const [startDate, setStartDate] = useState<Date>(startOfDay(subDays(new Date(), 7))) // Default to start of day, last 7 days
	const [endDate, setEndDate] = useState<Date>(endOfDay(new Date())) // Default to end of today
	const chartContainerRef = useRef<HTMLDivElement>(null) // Ref for container div

	const handleStartDateChange = (e: any) => {
		try {
			// Ensure time is preserved or set to start of day depending on desired behavior
			const date = parseISO(e.target.value)
			if (!isNaN(date.getTime())) {
				setStartDate(startOfDay(date)) // Set to start of the selected day
			}
		} catch (error) {
			console.error("Invalid start date:", e.target.value)
		}
	}

	const handleEndDateChange = (e: any) => {
		try {
			const date = parseISO(e.target.value)
			if (!isNaN(date.getTime())) {
				setEndDate(endOfDay(date)) // Set to end of the selected day
			}
		} catch (error) {
			console.error("Invalid end date:", e.target.value)
		}
	}

	const aggregatedData = useMemo(() => {
		// Ensure start date is not after end date
		const effectiveStartDate = startDate > endDate ? endDate : startDate
		const effectiveEndDate = endDate < startDate ? startDate : endDate

		const filteredData = historyData.filter((entry) =>
			isWithinInterval(new Date(entry.timestamp), { start: effectiveStartDate, end: effectiveEndDate }),
		)

		if (filteredData.length === 0) return []

		const dataMap = new Map<number, ChartDataPoint>()

		filteredData.forEach((entry) => {
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

		// Fill gaps and sort
		const result: ChartDataPoint[] = []
		let current = effectiveStartDate
		const end = effectiveEndDate

		while (current <= end) {
			let intervalStart: Date
			let nextIncrementFn: (date: Date) => Date

			switch (granularity) {
				case "15min":
					const minutes = current.getMinutes()
					const roundedMinutes = Math.floor(minutes / 15) * 15
					intervalStart = startOfMinute(current)
					intervalStart.setMinutes(roundedMinutes, 0, 0)
					nextIncrementFn = (d) => addMinutes(d, 15)
					break
				case "hourly":
					intervalStart = startOfHour(current)
					nextIncrementFn = (d) => addHours(d, 1) // Correctly wrap addHours
					break
				case "daily":
					intervalStart = startOfDay(current)
					nextIncrementFn = (d) => addDays(d, 1) // Correctly wrap addDays
					break
				case "weekly":
					intervalStart = startOfWeek(current, { weekStartsOn: 1 })
					nextIncrementFn = (d) => addWeeks(d, 1)
					break
				case "monthly":
					intervalStart = startOfMonth(current)
					nextIncrementFn = (d) => addMonths(d, 1) // Correctly wrap addMonths
					break
			}

			const timestampKey = intervalStart.getTime()
			// Only add if the interval *starts* within the selected range
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
			current = nextIncrementFn(intervalStart) // Use the wrapped increment function
		}

		// Ensure unique points and sort finally by timestamp
		const uniqueResult = Array.from(new Map(result.map((item) => [item.timestamp, item])).values())
		const finalData = uniqueResult.sort((a, b) => a.timestamp - b.timestamp)
		return finalData
	}, [historyData, granularity, startDate, endDate])

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
		if (value >= 1000000) {
			return `${(value / 1000000).toFixed(1)}M`
		}
		if (value >= 1000) {
			return `${(value / 1000).toFixed(1)}k`
		}
		return value.toString()
	}

	const chartDataKey = valueType

	return (
		<div className="flex flex-col flex-grow min-h-0 mb-4">
			<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-2">API USAGE CHART</div>
			<div className="flex gap-4 mb-3 items-end flex-wrap">
				{/* Controls */}
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
					<label htmlFor="start-date" className="text-xs block mb-1">
						Start Date
					</label>
					<VSCodeTextField
						id="start-date"
						type={"date" as any} // Cast type to any as workaround for TS error
						value={format(startDate, DATE_FORMAT)}
						onChange={handleStartDateChange}
					/>
				</div>
				<div>
					<label htmlFor="end-date" className="text-xs block mb-1">
						End Date
					</label>
					<VSCodeTextField
						id="end-date"
						type={"date" as any} // Cast type to any as workaround for TS error
						value={format(endDate, DATE_FORMAT)}
						onChange={handleEndDateChange}
					/>
				</div>
			</div>

			{/* Chart */}
			{/* Explicit height added here */}
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
						No data available for the selected period.
					</div>
				)}
			</div>
		</div>
	)
}

export default memo(ApiUsageChart)
