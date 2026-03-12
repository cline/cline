type TaskLatencyEvent = {
	presentationInvocationCount?: number
	partialMessageCount?: number
	statePostCount?: number
	statePostSerializedBytes?: number
	persistenceFlushCount?: number
	chunkToWebviewMedianMs?: number
	chunkToWebviewP95Ms?: number
	requestIndex?: number
	ulid?: string
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

export type TaskLatencySummary = {
	eventCount: number
	requestCount: number
	metrics: Record<NumericMetricKey, { average: number; min: number; max: number }>
}

const METRIC_KEYS: NumericMetricKey[] = [
	"presentationInvocationCount",
	"partialMessageCount",
	"statePostCount",
	"statePostSerializedBytes",
	"persistenceFlushCount",
	"chunkToWebviewMedianMs",
	"chunkToWebviewP95Ms",
]

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
	const requestKeys = new Set(
		events
			.map((event) => {
				if (event.ulid && Number.isFinite(event.requestIndex)) {
					return `${event.ulid}:${event.requestIndex}`
				}
				return undefined
			})
			.filter((value): value is string => Boolean(value)),
	)

	return {
		eventCount: events.length,
		requestCount: requestKeys.size,
		metrics: Object.fromEntries(
			METRIC_KEYS.map((key) => [key, summarizeMetric(events, key)]),
		) as TaskLatencySummary["metrics"],
	}
}

export type { TaskLatencyEvent }
