import { createRollingLatencyStats, type LatencySample } from "@shared/LatencyObserver"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient, UiServiceClient } from "@/services/grpc-client"
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

const OBSERVATION_SCENARIO_PROMPTS: Record<(typeof OBSERVATION_SCENARIOS)[number]["id"], { prompt: string; files?: string[] }> = {
	"ping-only": {
		prompt: "Latency observer ping-only scenario. Do not perform any tools. Respond with a short acknowledgement so transport RTT can be compared without task churn.",
	},
	"short-response": {
		prompt: "Latency observer short-response scenario. Answer in 2 concise sentences describing what you are measuring for responsiveness.",
	},
	"long-streaming": {
		prompt: "Latency observer long-streaming scenario. Produce a longer multi-paragraph explanation of how to compare perceived latency across branches, with enough content to stream for several seconds.",
	},
	"tool-heavy": {
		prompt: "Latency observer tool-heavy scenario. Inspect the repository by listing relevant files, then summarize likely hot paths for state churn and partial updates.",
	},
	"large-file": {
		prompt: "Latency observer large-file scenario. Read the latency observer plan document and summarize the sections most relevant to payload size and export behavior.",
		files: ["docs/remote-workspace-local-latency-observer-plan.md"],
	},
}

const capabilityLabel: Record<string, string> = {
	supported: "Supported",
	unsupported: "Unsupported on this branch",
	"hook-not-installed": "Observer hook not installed",
}

function formatMs(value: number | null | undefined): string {
	return value == null ? "-" : `${value.toFixed(2)} ms`
}

function formatDurationFromSample(sample?: LatencySample): string {
	return formatMs(sample?.durationMs)
}

function formatSampleCount(samples?: readonly unknown[]): string {
	return `${samples?.length ?? 0} sample${(samples?.length ?? 0) === 1 ? "" : "s"}`
}

function formatWallClockTime(timestamp: number | null | undefined): string {
	if (timestamp == null) {
		return "--:--:--"
	}

	return new Date(timestamp).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	})
}

function formatSinceTaskStart(timestamp: number | null | undefined, taskStartedAt: number | null | undefined): string {
	if (timestamp == null || taskStartedAt == null) {
		return "t+ -"
	}

	return `t+${(Math.max(0, timestamp - taskStartedAt) / 1000).toFixed(3)} s`
}

interface LatencyObserverSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

function containScrollWithinElement(event: React.WheelEvent<HTMLDivElement>) {
	const container = event.currentTarget
	const { scrollTop, scrollHeight, clientHeight } = container
	const canScroll = scrollHeight > clientHeight

	if (!canScroll) {
		return
	}

	const deltaY = event.deltaY
	const scrollingDown = deltaY > 0
	const scrollingUp = deltaY < 0
	const atTop = scrollTop <= 0
	const atBottom = Math.ceil(scrollTop + clientHeight) >= scrollHeight

	if ((scrollingUp && atTop) || (scrollingDown && atBottom)) {
		event.preventDefault()
	}

	event.stopPropagation()
}

const LatencyObserverSection = ({ renderSectionHeader }: LatencyObserverSectionProps) => {
	const { latencyObserver } = useExtensionState()
	const [payloadBytes, setPayloadBytes] = useState(0)
	const [samples, setSamples] = useState<LatencySample[]>([])
	const [isPinging, setIsPinging] = useState(false)
	const [isContinuousPinging, setIsContinuousPinging] = useState(false)
	const [isRunningPayloadSweep, setIsRunningPayloadSweep] = useState(false)
	const [isStartingScenario, setIsStartingScenario] = useState(false)
	const [pingError, setPingError] = useState<string | null>(null)
	const [selectedScenarioId, setSelectedScenarioId] = useState<(typeof OBSERVATION_SCENARIOS)[number]["id"]>("ping-only")
	const continuousPingEnabledRef = useRef(false)

	const selectedScenario =
		OBSERVATION_SCENARIOS.find((scenario) => scenario.id === selectedScenarioId) ?? OBSERVATION_SCENARIOS[0]

	const transportSamples = latencyObserver?.transport.samples ?? []
	const latestRequestSummary = latencyObserver?.requestCounterSummaries.at(-1)
	const latestTaskInitializationSample = latencyObserver?.taskInitialization.samples.at(-1)
	const latestFirstVisibleSample = latencyObserver?.firstVisibleUpdate.samples.at(-1)
	const latestFirstFullStateSample = latencyObserver?.firstFullStateUpdate.samples.at(-1)
	const latestFirstPartialSample = latencyObserver?.firstPartialMessageUpdate.samples.at(-1)
	const latestChunkToWebviewSample = latencyObserver?.chunkToWebview.samples.at(-1)
	const effectiveTransportSamples = useMemo(() => {
		if (transportSamples.length > 0) {
			return transportSamples
		}
		return samples
	}, [samples, transportSamples])
	const stats = useMemo(() => createRollingLatencyStats(effectiveTransportSamples), [effectiveTransportSamples])
	const latestRequestElapsedMs =
		latestRequestSummary != null ? Math.max(0, latestRequestSummary.completedAt - latestRequestSummary.startedAt) : null
	const timelineEntries = latencyObserver?.logs ?? []
	const perceivedTimelineCards = [
		{
			title: "Task initialized",
			value: formatDurationFromSample(latestTaskInitializationSample),
			subtitle: "Measured from task start",
			detail: formatSampleCount(latencyObserver?.taskInitialization.samples),
		},
		{
			title: "First visible assistant update",
			value: formatDurationFromSample(latestFirstVisibleSample),
			subtitle: "Measured from request start",
			detail: formatSampleCount(latencyObserver?.firstVisibleUpdate.samples),
		},
		{
			title: "First full-state update",
			value: formatDurationFromSample(latestFirstFullStateSample),
			subtitle: "Measured from request start",
			detail: formatSampleCount(latencyObserver?.firstFullStateUpdate.samples),
		},
		{
			title: "First partial-message update",
			value: formatDurationFromSample(latestFirstPartialSample),
			subtitle: "Measured from request start",
			detail: formatSampleCount(latencyObserver?.firstPartialMessageUpdate.samples),
		},
		{
			title: "Latest request end-to-end",
			value: formatMs(latestRequestElapsedMs),
			subtitle: "Measured from request start to completion",
			detail: latestRequestSummary?.requestId ?? "No completed request yet",
		},
		{
			title: "Chunk → webview hop",
			value: formatDurationFromSample(latestChunkToWebviewSample),
			subtitle: "Per-event delivery duration",
			detail: formatSampleCount(latencyObserver?.chunkToWebview.samples),
		},
	]
	const bottleneckHints = [
		latestFirstVisibleSample &&
		latestFirstFullStateSample &&
		latestFirstVisibleSample.durationMs - latestFirstFullStateSample.durationMs > 150
			? "First full-state arrives noticeably before the first visible assistant update, suggesting rendering / content-assembly delay after transport delivery."
			: null,
		latestFirstPartialSample &&
		latestFirstVisibleSample &&
		latestFirstVisibleSample.durationMs - latestFirstPartialSample.durationMs > 150
			? "Partial-message events are arriving before users see content, which points to UI-visible processing delay rather than raw backend arrival time."
			: null,
		latestChunkToWebviewSample && latestChunkToWebviewSample.durationMs > 75
			? "Chunk→webview delivery is elevated, which may indicate remote transport / extension-host delivery overhead becoming user-visible."
			: null,
		latestRequestSummary && latestRequestSummary.fullStatePushes + latestRequestSummary.partialMessageEvents > 25
			? "The latest request generated a high number of UI updates; compare this against local runs to see whether remote workspaces amplify visible churn."
			: null,
	].filter(Boolean) as string[]

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

	const startObservedScenario = async () => {
		const scenarioConfig = OBSERVATION_SCENARIO_PROMPTS[selectedScenario.id]
		setIsStartingScenario(true)
		setPingError(null)

		try {
			await TaskServiceClient.newTask(
				NewTaskRequest.create({
					text: scenarioConfig.prompt,
					images: [],
					files: scenarioConfig.files ?? [],
				}),
			)
		} catch (error) {
			setPingError(error instanceof Error ? error.message : String(error))
		} finally {
			setIsStartingScenario(false)
		}
	}

	return (
		<div>
			{renderSectionHeader("latency")}
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

					<div className="rounded border border-[var(--vscode-panel-border)] p-3 text-xs">
						<div className="font-medium text-foreground">What the user perceives as the task progresses</div>
						<p className="mb-0 mt-2 text-(--vscode-descriptionForeground)">
							Use these cards to distinguish between cumulative, from-start timings and per-event timings. The first
							group helps answer “how long did the human wait before seeing something?”, while the latter helps
							answer “how long does this step itself take once it begins?”.
						</p>
						<div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
							{perceivedTimelineCards.map((card) => (
								<div
									className="rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] p-3"
									key={card.title}>
									<div className="text-[11px] uppercase tracking-wide text-(--vscode-descriptionForeground)">
										{card.title}
									</div>
									<div className="mt-1 text-base font-medium text-foreground">{card.value}</div>
									<div className="mt-1 text-[11px] text-(--vscode-descriptionForeground)">{card.subtitle}</div>
									<div className="mt-2 text-[11px] text-(--vscode-descriptionForeground)">{card.detail}</div>
								</div>
							))}
						</div>
					</div>

					<div className="rounded border border-[var(--vscode-panel-border)] p-3 text-xs">
						<div className="font-medium text-foreground">Bottleneck hints to compare local vs remote workspaces</div>
						<ul className="mb-0 mt-2 list-disc pl-4 text-(--vscode-descriptionForeground)">
							<li>
								If <span className="text-foreground">first visible assistant update</span> grows much more than
								transport RTT, the human is feeling bottlenecks beyond the pipe.
							</li>
							<li>
								If <span className="text-foreground">first full-state / first partial-message</span> are early but
								visible content is late, the latency is likely in presentation or state handling rather than
								request dispatch.
							</li>
							<li>
								If <span className="text-foreground">chunk → webview</span> rises in remote workspaces, the
								delivery hop itself is becoming user-visible.
							</li>
							<li>
								If <span className="text-foreground">state bytes / partial bytes / UI deltas</span> spike, remote
								workspaces may feel slower because more UI work is happening while the user waits.
							</li>
							{bottleneckHints.length === 0 ? (
								<li>
									No strong bottleneck hint yet — run a scenario and compare the first-visible timeline against
									transport RTT.
								</li>
							) : (
								bottleneckHints.map((hint) => <li key={hint}>{hint}</li>)
							)}
						</ul>
					</div>

					<div className="rounded border border-[var(--vscode-panel-border)] p-3 text-xs text-(--vscode-descriptionForeground)">
						<div className="font-medium text-foreground">Observer session semantics</div>
						<p className="mb-0 mt-2">
							The latency observer now treats the{" "}
							<span className="text-foreground">most recently started task</span> as the active observer session.
							Starting a new task automatically clears prior observer data so the timeline stays aligned with what
							the user is currently experiencing.
						</p>
						<p className="mb-0 mt-2">
							Use <span className="text-foreground">Start Observed Task Scenario</span> or any new Cline task to
							begin a fresh observer session. You no longer need to manually reset the observer to correlate task
							start with user-perceived events.
						</p>
					</div>

					{latencyObserver && (
						<div className="rounded border border-[var(--vscode-panel-border)] p-3 text-xs">
							<div className="font-medium text-foreground">Observer event timeline</div>
							<p className="mb-0 mt-2 text-(--vscode-descriptionForeground)">
								Wall clock time, elapsed time since task start, and the event marker are shown together so you can
								follow perceived progress without scrolling to the bottom of the tab.
							</p>
							<div
								className="mt-3 max-h-56 overflow-auto overscroll-contain rounded border border-[var(--vscode-panel-border)] p-2"
								onWheelCapture={containScrollWithinElement}
								style={{ overscrollBehavior: "contain" }}>
								{timelineEntries.length === 0
									? "No observer events yet."
									: timelineEntries.map((entry) => (
											<div
												className="grid grid-cols-[auto_auto_1fr] gap-x-2 py-0.5"
												key={`${entry.ts}-${entry.message}`}>
												<span className="text-(--vscode-descriptionForeground)">
													{formatWallClockTime(entry.ts)}
												</span>
												<span className="text-(--vscode-descriptionForeground)">
													{formatSinceTaskStart(entry.ts, latencyObserver.session.startedAt)}
												</span>
												<span>{entry.message}</span>
											</div>
										))}
							</div>
						</div>
					)}

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

					<div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
						<Button
							className="w-full justify-center"
							disabled={isPinging || isContinuousPinging || isRunningPayloadSweep}
							onClick={() => runPing()}
							variant="secondary">
							{isPinging ? "Pinging..." : "Run Ping Probe"}
						</Button>
						<Button
							className="w-full justify-center"
							disabled={isRunningPayloadSweep}
							onClick={toggleContinuousPing}
							variant="secondary">
							{isContinuousPinging ? "Stop Continuous Ping" : "Start Continuous Ping"}
						</Button>
						<Button
							className="w-full justify-center"
							disabled={isStartingScenario}
							onClick={startObservedScenario}
							variant="secondary">
							{isStartingScenario ? "Starting Scenario..." : "Start Observed Task Scenario"}
						</Button>
						<Button
							className="w-full justify-center"
							disabled={isPinging || isContinuousPinging || isRunningPayloadSweep}
							onClick={runPayloadSweep}
							variant="ghost">
							Test Payload Presets
						</Button>
						<Button className="w-full justify-center" onClick={() => setSamples([])} variant="ghost">
							Reset Stats
						</Button>
						<Button
							className="w-full justify-center md:col-span-2 xl:col-span-2"
							disabled={!latencyObserver}
							onClick={exportLatencyObserverSession}
							variant="ghost">
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
							<div>Chunk→webview timing: {capabilityLabel[latencyObserver.capabilities.chunkToWebviewTiming]}</div>
							<div>Task UI delta metrics: {capabilityLabel[latencyObserver.capabilities.taskUiDeltaMetrics]}</div>
							<div>Persistence metrics: {capabilityLabel[latencyObserver.capabilities.persistenceMetrics]}</div>
							<div>Task init avg: {latencyObserver.taskInitialization.stats.avgMs?.toFixed(2) ?? "-"} ms</div>
							<div>First visible avg: {latencyObserver.firstVisibleUpdate.stats.avgMs?.toFixed(2) ?? "-"} ms</div>
							<div>
								First full-state avg: {latencyObserver.firstFullStateUpdate.stats.avgMs?.toFixed(2) ?? "-"} ms
							</div>
							<div>
								First partial avg: {latencyObserver.firstPartialMessageUpdate.stats.avgMs?.toFixed(2) ?? "-"} ms
							</div>
							<div>Chunk→webview avg: {latencyObserver.chunkToWebview.stats.avgMs?.toFixed(2) ?? "-"} ms</div>
							<div>Observed requests: {latencyObserver.requestStart.stats.count}</div>
							<div>State pushes: {latencyObserver.optionalCounters?.fullStatePushes ?? 0}</div>
							<div>State bytes: {latencyObserver.optionalCounters?.fullStateBytes ?? 0}</div>
							<div>Partial events: {latencyObserver.optionalCounters?.partialMessageEvents ?? 0}</div>
							<div>Partial bytes: {latencyObserver.optionalCounters?.partialMessageBytes ?? 0}</div>
							<div>Task UI deltas: {latencyObserver.optionalCounters?.taskUiDeltaEvents ?? 0}</div>
							<div>Persistence flushes: {latencyObserver.optionalCounters?.persistenceFlushes ?? 0}</div>
							{latestRequestSummary && (
								<>
									<div className="font-medium text-foreground">Latest request churn</div>
									<div>Req state pushes: {latestRequestSummary.fullStatePushes}</div>
									<div>Req state bytes: {latestRequestSummary.fullStateBytes}</div>
									<div>Req partial events: {latestRequestSummary.partialMessageEvents}</div>
									<div>Req partial bytes: {latestRequestSummary.partialMessageBytes}</div>
									<div>Req UI deltas: {latestRequestSummary.taskUiDeltaEvents}</div>
									<div>Req persistence flushes: {latestRequestSummary.persistenceFlushes}</div>
								</>
							)}
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

export default LatencyObserverSection
