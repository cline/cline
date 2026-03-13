type TaskLatencyEvent = {
	presentationInvocationCount?: number
	partialMessageCount?: number
	statePostCount?: number
	statePostSerializedBytes?: number
	persistenceFlushCount?: number
	chunkToWebviewMedianMs?: number
	chunkToWebviewP95Ms?: number
	taskInitializationDurationMs?: number
	durationMs?: number
	requestIndex?: number
	ulid?: string
	taskId?: string
	event?: string
	[key: string]: unknown
}

type NumericMetricKey =
	| "presentationInvocationCount"
	| "partialMessageCount"
	| "statePostCount"
	| "statePostSerializedBytes"
	| "persistenceFlushCount"
	| "chunkToWebviewMedianMs"
	| "chunkToWebviewP95Ms"
	| "taskInitializationDurationMs"

export type TaskLatencySummary = {
	eventCount: number
	requestCount: number
	metrics: Record<NumericMetricKey, { average: number; min: number; max: number }>
}

export type TaskLatencySummaryComparison = {
	baselineEvents: number
	candidateEvents: number
	metricDiffs: Record<NumericMetricKey, { averageDelta: number; minDelta: number; maxDelta: number }>
}

const METRIC_KEYS: NumericMetricKey[] = [
	"presentationInvocationCount",
	"partialMessageCount",
	"statePostCount",
	"statePostSerializedBytes",
	"persistenceFlushCount",
	"chunkToWebviewMedianMs",
	"chunkToWebviewP95Ms",
	"taskInitializationDurationMs",
]

function normalizeEvent(event: TaskLatencyEvent): TaskLatencyEvent {
	if (Number.isFinite(event.taskInitializationDurationMs)) {
		return event
	}

	if (event.event === "task.initialization" && Number.isFinite(event.durationMs)) {
		return {
			...event,
			taskInitializationDurationMs: event.durationMs as number,
		}
	}

	return event
}

function summarizeMetric(events: TaskLatencyEvent[], key: NumericMetricKey) {
	const values = events.map((event) => event[key]).filter((value): value is number => Number.isFinite(value))
	if (values.length === 0) {
		return { average: 0, min: 0, max: 0 }
	}

	const total = values.reduce((sum, value) => sum + value, 0)
	return {
		average: total / values.length,
		min: Math.min(...values),
		max: Math.max(...values),
	}
}

export function summarizeTaskLatencyEvents(events: TaskLatencyEvent[]): TaskLatencySummary {
	const normalizedEvents = events.map(normalizeEvent)
	const requestKeys = new Set(
		normalizedEvents
			.map((event) => {
				if (event.ulid && Number.isFinite(event.requestIndex)) {
					return `${event.ulid}:${event.requestIndex}`
				}
				return undefined
			})
			.filter((value): value is string => Boolean(value)),
	)

	return {
		eventCount: normalizedEvents.length,
		requestCount: requestKeys.size,
		metrics: Object.fromEntries(
			METRIC_KEYS.map((key) => [key, summarizeMetric(normalizedEvents, key)]),
		) as TaskLatencySummary["metrics"],
	}
}

export function compareTaskLatencySummaries(
	baseline: TaskLatencySummary,
	candidate: TaskLatencySummary,
): TaskLatencySummaryComparison {
	return {
		baselineEvents: baseline.eventCount,
		candidateEvents: candidate.eventCount,
		metricDiffs: Object.fromEntries(
			METRIC_KEYS.map((key) => [
				key,
				{
					averageDelta: candidate.metrics[key].average - baseline.metrics[key].average,
					minDelta: candidate.metrics[key].min - baseline.metrics[key].min,
					maxDelta: candidate.metrics[key].max - baseline.metrics[key].max,
				},
			]),
		) as TaskLatencySummaryComparison["metricDiffs"],
	}
}

export type { TaskLatencyEvent }
