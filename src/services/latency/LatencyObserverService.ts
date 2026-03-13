import {
	createRollingLatencyStats,
	DEFAULT_LATENCY_OBSERVER_CAPABILITIES,
	type LatencyObserverLogEntry,
	type LatencyObserverStateSnapshot,
	type LatencySample,
} from "@/shared/LatencyObserver"

type ActiveRequest = {
	requestId: string
	startedAt: number
	firstVisibleRecorded: boolean
}

export class LatencyObserverService {
	private readonly sessionStartedAt = Date.now()
	private readonly taskInitializationStarts = new Map<string, number>()
	private readonly activeRequests = new Map<string, ActiveRequest>()
	private readonly transportSamples: LatencySample[] = []
	private readonly taskInitializationSamples: LatencySample[] = []
	private readonly requestStartSamples: LatencySample[] = []
	private readonly firstVisibleUpdateSamples: LatencySample[] = []
	private readonly logs: LatencyObserverLogEntry[] = []

	markTaskInitializationStart(taskId: string, startedAt = performance.now()): void {
		this.taskInitializationStarts.set(taskId, startedAt)
		this.pushLog(`task initialization started`, taskId)
	}

	recordTaskInitializationEnd(taskId: string, endedAt = performance.now()): void {
		const startedAt = this.taskInitializationStarts.get(taskId)
		if (startedAt === undefined) {
			return
		}

		this.taskInitializationSamples.push({
			startedAt,
			endedAt,
			durationMs: Math.max(0, endedAt - startedAt),
			requestId: taskId,
		})
		this.taskInitializationStarts.delete(taskId)
		this.pushLog(`task initialization completed`, taskId)
	}

	markRequestStart(taskId: string, requestId: string, startedAt = performance.now()): void {
		this.activeRequests.set(taskId, {
			requestId,
			startedAt,
			firstVisibleRecorded: false,
		})
		this.requestStartSamples.push({
			startedAt,
			endedAt: startedAt,
			durationMs: 0,
			requestId,
		})
		this.pushLog(`request started`, taskId, requestId)
	}

	recordFirstVisibleUpdate(taskId: string, source: string, endedAt = performance.now()): void {
		const activeRequest = this.activeRequests.get(taskId)
		if (!activeRequest || activeRequest.firstVisibleRecorded) {
			return
		}

		activeRequest.firstVisibleRecorded = true
		this.firstVisibleUpdateSamples.push({
			startedAt: activeRequest.startedAt,
			endedAt,
			durationMs: Math.max(0, endedAt - activeRequest.startedAt),
			label: source,
			requestId: activeRequest.requestId,
		})
		this.pushLog(`first visible update (${source})`, taskId, activeRequest.requestId)
	}

	completeRequest(taskId: string): void {
		const activeRequest = this.activeRequests.get(taskId)
		if (!activeRequest) {
			return
		}

		this.activeRequests.delete(taskId)
		this.pushLog(`request completed`, taskId, activeRequest.requestId)
	}

	recordTransportSample(sample: LatencySample): void {
		this.transportSamples.push(sample)
	}

	getSnapshot(): LatencyObserverStateSnapshot {
		return {
			session: {
				startedAt: this.sessionStartedAt,
			},
			capabilities: {
				...DEFAULT_LATENCY_OBSERVER_CAPABILITIES,
				taskInitialization: "supported",
				requestStart: "supported",
				firstVisibleUpdate: "supported",
			},
			transport: {
				support: "supported",
				samples: [...this.transportSamples],
				stats: createRollingLatencyStats(this.transportSamples),
			},
			taskInitialization: {
				support: "supported",
				samples: [...this.taskInitializationSamples],
				stats: createRollingLatencyStats(this.taskInitializationSamples),
			},
			requestStart: {
				support: "supported",
				samples: [...this.requestStartSamples],
				stats: createRollingLatencyStats(this.requestStartSamples),
			},
			firstVisibleUpdate: {
				support: "supported",
				samples: [...this.firstVisibleUpdateSamples],
				stats: createRollingLatencyStats(this.firstVisibleUpdateSamples),
			},
			logs: [...this.logs],
		}
	}

	reset(): void {
		this.taskInitializationStarts.clear()
		this.activeRequests.clear()
		this.transportSamples.length = 0
		this.taskInitializationSamples.length = 0
		this.requestStartSamples.length = 0
		this.firstVisibleUpdateSamples.length = 0
		this.logs.length = 0
	}

	private pushLog(message: string, taskId?: string, requestId?: string): void {
		this.logs.push({
			ts: Date.now(),
			message,
			taskId,
			requestId,
		})
		if (this.logs.length > 50) {
			this.logs.shift()
		}
	}
}

let latencyObserverService: LatencyObserverService | undefined

export function getLatencyObserverService(): LatencyObserverService {
	latencyObserverService ??= new LatencyObserverService()
	return latencyObserverService
}
