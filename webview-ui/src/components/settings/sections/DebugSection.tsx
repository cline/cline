import { createRollingLatencyStats, type LatencySample } from "@shared/LatencyObserver"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient, UiServiceClient } from "@/services/grpc-client"
import Section from "../Section"

const PAYLOAD_PRESETS = [0, 64, 1024, 16_384] as const
const OBSERVATION_SCENARIOS = [
	{
		id: "ping-only",
		label: "Pure ping test",
		description: "Use ping presets and continuous ping to compare transport RTT and jitter only.",
	},
	{
		id: "short-response",
		label: "Short assistant response",
		description: "Run a brief question and compare request start, first visible update, and completion smoothness.",
	},
	{
		id: "long-streaming",
		label: "Long streaming response",
		description: "Use a longer prompt to compare first visible update timing and sustained streaming behavior.",
	},
	{
		id: "tool-heavy",
		label: "Tool-heavy / high churn",
		description: "Run a task that triggers multiple tool calls to compare state pushes, partials, and persistence churn.",
	},
	{
		id: "large-file",
		label: "Large-file-write adjacent",
		description: "Exercise file-heavy workflows to compare payload size effects and observer counters under load.",
	},
] as const

const capabilityLabel: Record<string, string> = {
	supported: "Supported",
	unsupported: "Unsupported on this branch",
	"hook-not-installed": "Observer hook not installed",
}

interface DebugSectionProps {
	onResetState: (resetGlobalState?: boolean) => Promise<void>
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const DebugSection = ({ onResetState, renderSectionHeader }: DebugSectionProps) => {
	const { latencyObserver, setShowWelcome } = useExtensionState()
	const [payloadBytes, setPayloadBytes] = useState(0)
	const [samples, setSamples] = useState<LatencySample[]>([])
	const [isPinging, setIsPinging] = useState(false)
	const [isContinuousPinging, setIsContinuousPinging] = useState(false)
	const [isRunningPayloadSweep, setIsRunningPayloadSweep] = useState(false)
	const [pingError, setPingError] = useState<string | null>(null)
	const [selectedScenarioId, setSelectedScenarioId] = useState<(typeof OBSERVATION_SCENARIOS)[number]["id"]>("ping-only")
	const continuousPingEnabledRef = useRef(false)
	const selectedScenario =
		OBSERVATION_SCENARIOS.find((scenario) => scenario.id === selectedScenarioId) ?? OBSERVATION_SCENARIOS[0]

	const transportSamples = latencyObserver?.transport.samples ?? []
	const effectiveTransportSamples = useMemo(() => {
		if (transportSamples.length > 0) {
			return transportSamples
		}
		return samples
	}, [samples, transportSamples])
	const stats = useMemo(() => createRollingLatencyStats(effectiveTransportSamples), [effectiveTransportSamples])

	const runPing = async (nextPayloadBytes = payloadBytes) => {
		setIsPinging(true)
		setPingError(null)
		const startedAt = performance.now()

		try {
			await UiServiceClient.pingLatencyProbe({ value: new Uint8Array(nextPayloadBytes) })
			const endedAt = performance.now()
			setSamples((current) => [
				...current,
				{
					startedAt,
					endedAt,
					durationMs: endedAt - startedAt,
					payloadBytes: nextPayloadBytes,
				},
			])
		} catch (error) {
			setPingError(error instanceof Error ? error.message : String(error))
		} finally {
			setIsPinging(false)
		}
	}

	const runPayloadSweep = async () => {
		setIsRunningPayloadSweep(true)
		setPingError(null)

		try {
			for (const preset of PAYLOAD_PRESETS) {
				await runPing(preset)
			}
		} finally {
			setIsRunningPayloadSweep(false)
		}
	}

	const toggleContinuousPing = async () => {
		if (isContinuousPinging) {
			continuousPingEnabledRef.current = false
			setIsContinuousPinging(false)
			return
		}

		continuousPingEnabledRef.current = true
		setIsContinuousPinging(true)
		setPingError(null)

		try {
			while (continuousPingEnabledRef.current) {
				await runPing(payloadBytes)
				if (!continuousPingEnabledRef.current) {
					break
				}
				await new Promise((resolve) => setTimeout(resolve, 500))
			}
		} finally {
			continuousPingEnabledRef.current = false
			setIsContinuousPinging(false)
		}
	}

	useEffect(() => {
		return () => {
			continuousPingEnabledRef.current = false
		}
	}, [])

	const exportLatencyObserverSession = () => {
		if (!latencyObserver) {
			return
		}

		const exportSnapshot = {
			...latencyObserver,
			observationScenario: {
				id: selectedScenario.id,
				label: selectedScenario.label,
				description: selectedScenario.description,
			},
			transport: {
				...latencyObserver.transport,
				samples: effectiveTransportSamples,
				stats,
			},
		}

		const blob = new Blob([JSON.stringify(exportSnapshot, null, 2)], { type: "application/json" })
		const url = URL.createObjectURL(blob)
		const anchor = document.createElement("a")
		const branchLabel = latencyObserver.session.branch ?? "unknown-branch"
		const commitLabel = latencyObserver.session.commit?.slice(0, 8) ?? "unknown-commit"
		anchor.href = url
		anchor.download = `latency-observer-${branchLabel}-${commitLabel}.json`
		anchor.click()
		URL.revokeObjectURL(url)
	}

	return (
		<div>
			{renderSectionHeader("debug")}
			<Section>
				<div className="flex flex-col gap-3">
					<h4 className="m-0 text-sm font-medium">Latency Observer</h4>
					<p className="m-0 text-xs text-(--vscode-descriptionForeground)">
						Use this panel to compare transport RTT and task-lifecycle responsiveness across branches.
					</p>
					<div className="flex flex-col gap-1 text-xs text-(--vscode-descriptionForeground)">
						<span>Observation scenario</span>
						<Select
							onValueChange={(value) =>
								setSelectedScenarioId(value as (typeof OBSERVATION_SCENARIOS)[number]["id"])
							}
							value={selectedScenarioId}>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{OBSERVATION_SCENARIOS.map((scenario) => (
									<SelectItem key={scenario.id} value={scenario.id}>
										{scenario.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="m-0">{selectedScenario.description}</p>
					</div>
					<div className="rounded border border-[var(--vscode-panel-border)] p-2 text-xs text-(--vscode-descriptionForeground)">
						<div className="font-medium text-foreground">How to interpret these numbers</div>
						<ul className="mb-0 mt-2 list-disc pl-4">
							<li>Ping RTT is a lower-level transport signal, not a full UX measurement.</li>
							<li>
								Task initialization and first visible update are better proxies for user-perceived responsiveness.
							</li>
							<li>
								State push, partial-message, and persistence counters help explain why one branch feels faster.
							</li>
							<li>Compare the same scenario, payload, and environment across branches for meaningful results.</li>
						</ul>
					</div>
					<div className="rounded border border-[var(--vscode-panel-border)] p-2 text-xs text-(--vscode-descriptionForeground)">
						<div className="font-medium text-foreground">Branch-portable vs richer metrics</div>
						<p className="mb-0 mt-2">
							Transport RTT, task initialization, request count, first visible update, logs, and export data are
							intended to stay branch-portable. Full-state bytes, partial-message bytes, task UI deltas, and future
							chunk timing are richer metrics that may vary by branch capability.
						</p>
					</div>
					<label className="flex flex-col gap-1 text-xs text-(--vscode-descriptionForeground)">
						<span>Ping payload bytes</span>
						<input
							aria-label="Ping payload bytes"
							className="bg-input text-foreground border border-input rounded px-2 py-1"
							min={0}
							onChange={(event) => setPayloadBytes(Math.max(0, Number(event.target.value) || 0))}
							type="number"
							value={payloadBytes}
						/>
					</label>
					<div className="flex gap-2">
						<Button
							disabled={isPinging || isContinuousPinging || isRunningPayloadSweep}
							onClick={() => runPing()}
							variant="secondary">
							{isPinging ? "Pinging..." : "Run Ping Probe"}
						</Button>
						<Button disabled={isRunningPayloadSweep} onClick={toggleContinuousPing} variant="secondary">
							{isContinuousPinging ? "Stop Continuous Ping" : "Start Continuous Ping"}
						</Button>
						<Button
							disabled={isPinging || isContinuousPinging || isRunningPayloadSweep}
							onClick={runPayloadSweep}
							variant="ghost">
							Test Payload Presets
						</Button>
						<Button onClick={() => setSamples([])} variant="ghost">
							Reset Stats
						</Button>
						<Button disabled={!latencyObserver} onClick={exportLatencyObserverSession} variant="ghost">
							Export Session JSON
						</Button>
					</div>
					<div className="grid grid-cols-2 gap-2 text-xs">
						<div>Samples: {stats.count}</div>
						<div>Last: {stats.lastMs?.toFixed(2) ?? "-"} ms</div>
						<div>Min: {stats.minMs?.toFixed(2) ?? "-"} ms</div>
						<div>Max: {stats.maxMs?.toFixed(2) ?? "-"} ms</div>
						<div>Avg: {stats.avgMs?.toFixed(2) ?? "-"} ms</div>
						<div>Payload: {payloadBytes} bytes</div>
					</div>
					<div className="flex flex-wrap gap-2 text-xs text-(--vscode-descriptionForeground)">
						{PAYLOAD_PRESETS.map((preset) => (
							<button
								className="rounded border border-[var(--vscode-panel-border)] px-2 py-1"
								key={preset}
								onClick={() => setPayloadBytes(preset)}
								type="button">
								{preset.toLocaleString()} B
							</button>
						))}
					</div>
					{pingError && <p className="m-0 text-xs text-[var(--vscode-errorForeground)]">{pingError}</p>}
					{latencyObserver && (
						<div className="flex flex-col gap-2 border-t border-[var(--vscode-panel-border)] pt-3 text-xs">
							<div>Scenario: {selectedScenario.label}</div>
							<div>Branch: {latencyObserver.session.branch ?? "unknown"}</div>
							<div>Commit: {latencyObserver.session.commit?.slice(0, 8) ?? "unknown"}</div>
							<div>Environment: {String(latencyObserver.session.environment ?? "unknown")}</div>
							<div>Transport probe: {capabilityLabel[latencyObserver.capabilities.transportProbe]}</div>
							<div>Full-state metrics: {capabilityLabel[latencyObserver.capabilities.fullStateMetrics]}</div>
							<div>
								Partial-message metrics: {capabilityLabel[latencyObserver.capabilities.partialMessageMetrics]}
							</div>
							<div>Task UI delta metrics: {capabilityLabel[latencyObserver.capabilities.taskUiDeltaMetrics]}</div>
							<div>Persistence metrics: {capabilityLabel[latencyObserver.capabilities.persistenceMetrics]}</div>
							<div>Task init avg: {latencyObserver.taskInitialization.stats.avgMs?.toFixed(2) ?? "-"} ms</div>
							<div>First visible avg: {latencyObserver.firstVisibleUpdate.stats.avgMs?.toFixed(2) ?? "-"} ms</div>
							<div>Observed requests: {latencyObserver.requestStart.stats.count}</div>
							<div>State pushes: {latencyObserver.optionalCounters?.fullStatePushes ?? 0}</div>
							<div>State bytes: {latencyObserver.optionalCounters?.fullStateBytes ?? 0}</div>
							<div>Partial events: {latencyObserver.optionalCounters?.partialMessageEvents ?? 0}</div>
							<div>Partial bytes: {latencyObserver.optionalCounters?.partialMessageBytes ?? 0}</div>
							<div>Task UI deltas: {latencyObserver.optionalCounters?.taskUiDeltaEvents ?? 0}</div>
							<div>Persistence flushes: {latencyObserver.optionalCounters?.persistenceFlushes ?? 0}</div>
							<div className="max-h-24 overflow-auto rounded border border-[var(--vscode-panel-border)] p-2">
								{latencyObserver.logs.length === 0
									? "No observer events yet."
									: latencyObserver.logs
											.slice(-5)
											.map((entry) => <div key={`${entry.ts}-${entry.message}`}>{entry.message}</div>)}
							</div>
						</div>
					)}
				</div>
			</Section>
			<Section>
				<Button onClick={() => onResetState()} variant="error">
					Reset Workspace State
				</Button>
				<Button onClick={() => onResetState(true)} variant="error">
					Reset Global State
				</Button>
				<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
					This will reset all global state and secret storage in the extension.
				</p>
			</Section>
			<Section>
				<Button
					onClick={async () =>
						await StateServiceClient.setWelcomeViewCompleted({ value: false })
							.catch(() => {})
							.finally(() => setShowWelcome(true))
					}
					variant="secondary">
					Reset Onboarding State
				</Button>
			</Section>
		</div>
	)
}

export default DebugSection
