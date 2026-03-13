export type LatencyObserverMetricSupport = "supported" | "unsupported" | "hook-not-installed"

export interface LatencySample {
	startedAt: number
	endedAt: number
	durationMs: number
	label?: string
	payloadBytes?: number
	requestId?: string
	metadata?: Record<string, string | number | boolean | null | undefined>
}

export interface RollingLatencyStats {
	count: number
	minMs: number | null
	maxMs: number | null
	avgMs: number | null
	lastMs: number | null
	totalMs: number
}

export interface LatencyObserverSessionMetadata {
	branch?: string
	commit?: string
	environment?: string
	platform?: string
	startedAt: number
	label?: string
}

export interface LatencyObserverCapabilities {
	transportProbe: LatencyObserverMetricSupport
	taskInitialization: LatencyObserverMetricSupport
	requestStart: LatencyObserverMetricSupport
	firstVisibleUpdate: LatencyObserverMetricSupport
	fullStateMetrics: LatencyObserverMetricSupport
	partialMessageMetrics: LatencyObserverMetricSupport
	taskUiDeltaMetrics: LatencyObserverMetricSupport
	persistenceMetrics: LatencyObserverMetricSupport
}

export interface LatencyObserverMetricSet {
	transportSamples: LatencySample[]
	requestStartSamples: LatencySample[]
	taskInitializationSamples: LatencySample[]
	firstVisibleUpdateSamples: LatencySample[]
	capabilities: LatencyObserverCapabilities
	session: LatencyObserverSessionMetadata
	optionalCounters?: Partial<
		Record<"fullStatePushes" | "partialMessageEvents" | "taskUiDeltaEvents" | "persistenceFlushes", number>
	>
}

export interface LatencyObserverMetricSnapshot {
	support: LatencyObserverMetricSupport
	samples: LatencySample[]
	stats: RollingLatencyStats
}

export interface LatencyObserverLogEntry {
	ts: number
	message: string
	taskId?: string
	requestId?: string
}

export interface LatencyObserverStateSnapshot {
	session: LatencyObserverSessionMetadata
	capabilities: LatencyObserverCapabilities
	transport: LatencyObserverMetricSnapshot
	taskInitialization: LatencyObserverMetricSnapshot
	requestStart: LatencyObserverMetricSnapshot
	firstVisibleUpdate: LatencyObserverMetricSnapshot
	logs: LatencyObserverLogEntry[]
	optionalCounters?: LatencyObserverMetricSet["optionalCounters"]
}

export const DEFAULT_LATENCY_OBSERVER_CAPABILITIES: LatencyObserverCapabilities = {
	transportProbe: "supported",
	taskInitialization: "unsupported",
	requestStart: "unsupported",
	firstVisibleUpdate: "unsupported",
	fullStateMetrics: "unsupported",
	partialMessageMetrics: "unsupported",
	taskUiDeltaMetrics: "unsupported",
	persistenceMetrics: "unsupported",
}

export function createRollingLatencyStats(samples: readonly LatencySample[]): RollingLatencyStats {
	if (samples.length === 0) {
		return {
			count: 0,
			minMs: null,
			maxMs: null,
			avgMs: null,
			lastMs: null,
			totalMs: 0,
		}
	}

	const durations = samples.map((sample) => sample.durationMs)
	const totalMs = durations.reduce((sum, duration) => sum + duration, 0)

	return {
		count: samples.length,
		minMs: Math.min(...durations),
		maxMs: Math.max(...durations),
		avgMs: totalMs / samples.length,
		lastMs: samples.at(-1)?.durationMs ?? null,
		totalMs,
	}
}
