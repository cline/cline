import { VSCodeButton, VSCodeRadioGroup, VSCodeRadio } from "@vscode/webview-ui-toolkit/react"
import { Activity, Play, Square, Zap } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { PingRequest } from "@shared/proto/cline/ui"
import { UiServiceClient } from "../../services/grpc-client"

interface LatencyStats {
	current: number
	min: number
	max: number
	average: number
	count: number
	total: number
}

interface PayloadSizeStats {
	[key: number]: LatencyStats
}

const PAYLOAD_SIZES = [
	{ kb: 1, label: "Small (1KB)" },
	{ kb: 100, label: "Medium (100KB)" },
	{ kb: 1024, label: "Large (1MB)" },
]

const LatencyTester = () => {
	const [isRunning, setIsRunning] = useState(false)
	const [selectedPayloadSize, setSelectedPayloadSize] = useState(1)
	const [payloadStats, setPayloadStats] = useState<PayloadSizeStats>({})
	const [logs, setLogs] = useState<string[]>([])
	const intervalRef = useRef<NodeJS.Timeout | null>(null)
	const pendingPingRef = useRef<number | null>(null)

	const addLog = useCallback((message: string) => {
		const timestamp = new Date().toLocaleTimeString()
		setLogs((prev) => [`[${timestamp}] ${message}`, ...prev.slice(0, 19)]) // Keep last 20 logs
	}, [])

	const updateStats = useCallback((latency: number, payloadSizeKB: number) => {
		setPayloadStats((prev) => {
			const currentStats = prev[payloadSizeKB] || {
				current: 0,
				min: Infinity,
				max: 0,
				average: 0,
				count: 0,
				total: 0,
			}

			const newCount = currentStats.count + 1
			const newTotal = currentStats.total + latency
			const newAverage = newTotal / newCount
			const newMin = Math.min(currentStats.min === Infinity ? latency : currentStats.min, latency)
			const newMax = Math.max(currentStats.max, latency)

			return {
				...prev,
				[payloadSizeKB]: {
					current: latency,
					min: newMin,
					max: newMax,
					average: newAverage,
					count: newCount,
					total: newTotal,
				},
			}
		})
	}, [])

	const sendPing = useCallback(
		async (payloadSizeKB: number = selectedPayloadSize) => {
			if (pendingPingRef.current !== null) {
				addLog("⚠️ Previous ping still pending, skipping...")
				return
			}

			const startTime = performance.now()
			pendingPingRef.current = startTime

			addLog(`🏓 Sending gRPC ping (${payloadSizeKB}KB payload)...`)

			try {
				// Send ping with specified payload size
				const response = await UiServiceClient.ping(
					PingRequest.create({
						timestamp: Math.floor(startTime),
						payloadSizeKb: payloadSizeKB,
					}),
				)

				// Calculate actual round-trip latency
				const endTime = performance.now()
				const actualLatency = endTime - startTime

				// Clear pending ping
				pendingPingRef.current = null

				// Update stats for this payload size
				updateStats(actualLatency, payloadSizeKB)

				// Log result with debugging info
				addLog(`✅ gRPC Pong received (${payloadSizeKB}KB) - Round-trip: ${actualLatency.toFixed(2)}ms`)
			} catch (error) {
				// Clear pending ping
				pendingPingRef.current = null

				addLog(`❌ gRPC Ping failed (${payloadSizeKB}KB): ${error}`)
				console.error("gRPC ping failed:", error)
			}
		},
		[selectedPayloadSize, addLog, updateStats],
	)

	const testAllSizes = useCallback(async () => {
		if (pendingPingRef.current !== null) {
			addLog("⚠️ Test already in progress, skipping...")
			return
		}

		addLog("🚀 Testing all payload sizes...")

		for (const size of PAYLOAD_SIZES) {
			await sendPing(size.kb)
			// Small delay between tests
			await new Promise((resolve) => setTimeout(resolve, 500))
		}

		addLog("✅ All payload size tests completed")
	}, [sendPing, addLog])

	const startContinuousTesting = useCallback(() => {
		if (isRunning) return

		setIsRunning(true)
		addLog(`🚀 Starting continuous latency testing (${selectedPayloadSize}KB payload, every 2 seconds)`)

		// Send first ping immediately
		sendPing()

		// Then send pings every 2 seconds
		intervalRef.current = setInterval(() => {
			sendPing()
		}, 2000)
	}, [isRunning, selectedPayloadSize, sendPing, addLog])

	const stopContinuousTesting = useCallback(() => {
		if (!isRunning) return

		setIsRunning(false)
		addLog("⏹️ Stopped continuous testing")

		if (intervalRef.current) {
			clearInterval(intervalRef.current)
			intervalRef.current = null
		}

		// Clear any pending ping
		pendingPingRef.current = null
	}, [isRunning, addLog])

	const resetStats = useCallback(() => {
		setPayloadStats({})
		setLogs([])
		addLog("📊 Stats reset")
	}, [addLog])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current)
			}
		}
	}, [])

	const getLatencyColor = (latency: number) => {
		if (latency < 1050) return "text-green-400" // Expected ~1000ms + network
		if (latency < 1150) return "text-yellow-400"
		return "text-red-400"
	}

	const currentStats = payloadStats[selectedPayloadSize]

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 mb-4">
				<Activity className="w-4 h-4" />
				<h4 className="text-sm font-medium">Latency Tester</h4>
			</div>

			<p className="text-xs text-[var(--vscode-descriptionForeground)] mb-4">
				Measure gRPC round-trip latency with variable payload sizes. Useful for testing performance in remote environments
				like GitHub Codespaces.
			</p>

			{/* Payload Size Selection */}
			<div className="space-y-2">
				<div className="text-xs font-medium">Payload Size:</div>
				<VSCodeRadioGroup
					value={selectedPayloadSize.toString()}
					onChange={(e) => setSelectedPayloadSize(parseInt((e.target as any).value))}>
					{PAYLOAD_SIZES.map((size) => (
						<VSCodeRadio key={size.kb} value={size.kb.toString()}>
							{size.label}
						</VSCodeRadio>
					))}
				</VSCodeRadioGroup>
			</div>

			{/* Controls */}
			<div className="flex gap-2 mb-4">
				<VSCodeButton onClick={() => sendPing()} disabled={isRunning}>
					Single Ping
				</VSCodeButton>

				<VSCodeButton onClick={testAllSizes} disabled={isRunning}>
					<Zap className="w-3 h-3 mr-1" />
					Test All Sizes
				</VSCodeButton>

				{!isRunning ? (
					<VSCodeButton onClick={startContinuousTesting}>
						<Play className="w-3 h-3 mr-1" />
						Start Continuous
					</VSCodeButton>
				) : (
					<VSCodeButton onClick={stopContinuousTesting}>
						<Square className="w-3 h-3 mr-1" />
						Stop
					</VSCodeButton>
				)}

				<VSCodeButton onClick={resetStats}>Reset</VSCodeButton>
			</div>

			{/* Stats Table */}
			{Object.keys(payloadStats).length > 0 && (
				<div className="space-y-2">
					<div className="text-xs font-medium">Results by Payload Size:</div>
					<div className="bg-[var(--vscode-textBlockQuote-background)] rounded border-l-2 border-[var(--vscode-textBlockQuote-border)] overflow-hidden">
						<table className="w-full text-xs">
							<thead className="bg-[var(--vscode-editor-background)]">
								<tr>
									<th className="text-left p-2">Size</th>
									<th className="text-left p-2">Current</th>
									<th className="text-left p-2">Min</th>
									<th className="text-left p-2">Max</th>
									<th className="text-left p-2">Avg</th>
									<th className="text-left p-2">Count</th>
								</tr>
							</thead>
							<tbody>
								{PAYLOAD_SIZES.map((size) => {
									const stats = payloadStats[size.kb]
									if (!stats) return null

									return (
										<tr
											key={size.kb}
											className={
												selectedPayloadSize === size.kb
													? "bg-[var(--vscode-list-activeSelectionBackground)]"
													: ""
											}>
											<td className="p-2 font-mono">{size.kb}KB</td>
											<td className={`p-2 font-mono ${getLatencyColor(stats.current)}`}>
												{stats.current.toFixed(2)}ms
											</td>
											<td className={`p-2 font-mono ${getLatencyColor(stats.min)}`}>
												{stats.min.toFixed(2)}ms
											</td>
											<td className={`p-2 font-mono ${getLatencyColor(stats.max)}`}>
												{stats.max.toFixed(2)}ms
											</td>
											<td className={`p-2 font-mono ${getLatencyColor(stats.average)}`}>
												{stats.average.toFixed(2)}ms
											</td>
											<td className="p-2 font-mono">{stats.count}</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>

					{currentStats && currentStats.average > 1150 && (
						<div className="text-xs text-red-400">
							⚠️ High latency detected for {selectedPayloadSize}KB payload - may indicate network bandwidth
							limitations
						</div>
					)}
				</div>
			)}

			{/* Logs */}
			{logs.length > 0 && (
				<div className="space-y-2">
					<div className="text-xs font-medium">Recent Activity:</div>
					<div className="max-h-32 overflow-y-auto bg-[var(--vscode-editor-background)] p-2 rounded text-xs font-mono">
						{logs.map((log, index) => (
							<div key={index} className="text-[var(--vscode-editor-foreground)]">
								{log}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

export default LatencyTester
