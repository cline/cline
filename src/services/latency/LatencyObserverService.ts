import {
	createRollingLatencyStats,
	DEFAULT_LATENCY_OBSERVER_CAPABILITIES,
	type LatencyObserverCapabilities,
	type LatencyObserverLogEntry,
	type LatencyObserverRequestCounterSummary,
	type LatencyObserverSessionMetadata,
	type LatencyObserverStateSnapshot,
	type LatencySample,
} from "@/shared/LatencyObserver"

type ActiveRequest = {
	taskId: string
	requestId: string
	startedAt: number
	firstVisibleRecorded: boolean
	firstFullStateRecorded: boolean
	firstPartialMessageRecorded: boolean
	counterBaseline: Record<
		| "fullStatePushes"
		| "fullStateBytes"
		| "partialMessageEvents"
		| "partialMessageBytes"
		| "taskUiDeltaEvents"
		| "persistenceFlushes",
		number
	>
}

export class LatencyObserverService {
	private sessionStartedAt = Date.now()
	private currentObservedTaskId: string | undefined
	private sessionMetadata: LatencyObserverSessionMetadata = {
		startedAt: this.sessionStartedAt,
	}
	private capabilities: LatencyObserverCapabilities = {
		...DEFAULT_LATENCY_OBSERVER_CAPABILITIES,
		taskInitialization: "supported",
		requestStart: "supported",
		firstVisibleUpdate: "supported",
		firstFullStateUpdate: "supported",
		firstPartialMessageUpdate: "supported",
		chunkToWebviewTiming: "supported",
	}
	private readonly taskInitializationStarts = new Map<string, number>()
	private readonly activeRequests = new Map<string, ActiveRequest>()
	private readonly transportSamples: LatencySample[] = []
	private readonly taskInitializationSamples: LatencySample[] = []
	private readonly requestStartSamples: LatencySample[] = []
	private readonly firstVisibleUpdateSamples: LatencySample[] = []
	private readonly firstFullStateUpdateSamples: LatencySample[] = []
	private readonly firstPartialMessageUpdateSamples: LatencySample[] = []
	private readonly chunkToWebviewSamples: LatencySample[] = []
	private readonly requestCounterSummaries: LatencyObserverRequestCounterSummary[] = []
	private readonly logs: LatencyObserverLogEntry[] = []
	private optionalCounters: Record<
		| "fullStatePushes"
		| "fullStateBytes"
		| "partialMessageEvents"
		| "partialMessageBytes"
		| "taskUiDeltaEvents"
		| "persistenceFlushes",
		number
	> = {
		fullStatePushes: 0,
		fullStateBytes: 0,
		partialMessageEvents: 0,
		partialMessageBytes: 0,
		taskUiDeltaEvents: 0,
		persistenceFlushes: 0,
	}

	setSessionMetadata(metadata: Partial<Omit<LatencyObserverSessionMetadata, "startedAt">>): void {
		this.sessionMetadata = {
			...this.sessionMetadata,
			...metadata,
			startedAt: this.sessionStartedAt,
		}
	}

	setCapability<K extends keyof LatencyObserverCapabilities>(key: K, value: LatencyObserverCapabilities[K]): void {
		this.capabilities[key] = value
	}

	markTaskInitializationStart(taskId: string, startedAt = performance.now()): void {
		if (this.currentObservedTaskId !== taskId) {
			this.resetForTask(taskId)
		}
		this.pushLog(`task_start`, taskId)
		this.taskInitializationStarts.set(taskId, startedAt)
		this.pushLog(`task initialization started`, taskId)
	}

	markTaskComplete(taskId: string): void {
		if (this.currentObservedTaskId !== taskId) {
			return
		}
		this.pushLog(`task_complete`, taskId)
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
			taskId,
			requestId,
			startedAt,
			firstVisibleRecorded: false,
			firstFullStateRecorded: false,
			firstPartialMessageRecorded: false,
			counterBaseline: { ...this.optionalCounters },
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

	recordFirstFullStateUpdate(taskId: string, endedAt = performance.now()): void {
		const activeRequest = this.activeRequests.get(taskId)
		if (!activeRequest || activeRequest.firstFullStateRecorded) {
			return
		}

		activeRequest.firstFullStateRecorded = true
		this.firstFullStateUpdateSamples.push({
			startedAt: activeRequest.startedAt,
			endedAt,
			durationMs: Math.max(0, endedAt - activeRequest.startedAt),
			requestId: activeRequest.requestId,
			label: "full-state",
		})
		this.pushLog(`first full-state update`, taskId, activeRequest.requestId)
	}

	recordFirstPartialMessageUpdate(taskId: string, endedAt = performance.now()): void {
		const activeRequest = this.activeRequests.get(taskId)
		if (!activeRequest || activeRequest.firstPartialMessageRecorded) {
			return
		}

		activeRequest.firstPartialMessageRecorded = true
		this.firstPartialMessageUpdateSamples.push({
			startedAt: activeRequest.startedAt,
			endedAt,
			durationMs: Math.max(0, endedAt - activeRequest.startedAt),
			requestId: activeRequest.requestId,
			label: "partial-message",
		})
		this.pushLog(`first partial-message update`, taskId, activeRequest.requestId)
	}

	recordChunkToWebviewDelivery(sample: LatencySample): void {
		this.chunkToWebviewSamples.push(sample)
		if (this.chunkToWebviewSamples.length > 200) {
			this.chunkToWebviewSamples.shift()
		}
	}

	completeRequest(taskId: string): void {
		const activeRequest = this.activeRequests.get(taskId)
		if (!activeRequest) {
			return
		}

		this.requestCounterSummaries.push({
			requestId: activeRequest.requestId,
			taskId: activeRequest.taskId,
			startedAt: activeRequest.startedAt,
			completedAt: performance.now(),
			fullStatePushes: this.optionalCounters.fullStatePushes - activeRequest.counterBaseline.fullStatePushes,
			fullStateBytes: this.optionalCounters.fullStateBytes - activeRequest.counterBaseline.fullStateBytes,
			partialMessageEvents: this.optionalCounters.partialMessageEvents - activeRequest.counterBaseline.partialMessageEvents,
			partialMessageBytes: this.optionalCounters.partialMessageBytes - activeRequest.counterBaseline.partialMessageBytes,
			taskUiDeltaEvents: this.optionalCounters.taskUiDeltaEvents - activeRequest.counterBaseline.taskUiDeltaEvents,
			persistenceFlushes: this.optionalCounters.persistenceFlushes - activeRequest.counterBaseline.persistenceFlushes,
		})
		if (this.requestCounterSummaries.length > 50) {
			this.requestCounterSummaries.shift()
		}

		this.activeRequests.delete(taskId)
		this.pushLog(`request completed`, taskId, activeRequest.requestId)
	}

	recordTransportSample(sample: LatencySample): void {
		this.transportSamples.push(sample)
	}

	incrementCounter(counter: keyof typeof this.optionalCounters, amount = 1): void {
		this.optionalCounters[counter] += amount
	}

	getSnapshot(): LatencyObserverStateSnapshot {
		return {
			session: { ...this.sessionMetadata },
			capabilities: { ...this.capabilities },
			transport: {
				support: this.capabilities.transportProbe,
				samples: [...this.transportSamples],
				stats: createRollingLatencyStats(this.transportSamples),
			},
			taskInitialization: {
				support: this.capabilities.taskInitialization,
				samples: [...this.taskInitializationSamples],
				stats: createRollingLatencyStats(this.taskInitializationSamples),
			},
			requestStart: {
				support: this.capabilities.requestStart,
				samples: [...this.requestStartSamples],
				stats: createRollingLatencyStats(this.requestStartSamples),
			},
			firstVisibleUpdate: {
				support: this.capabilities.firstVisibleUpdate,
				samples: [...this.firstVisibleUpdateSamples],
				stats: createRollingLatencyStats(this.firstVisibleUpdateSamples),
			},
			firstFullStateUpdate: {
				support: this.capabilities.firstFullStateUpdate,
				samples: [...this.firstFullStateUpdateSamples],
				stats: createRollingLatencyStats(this.firstFullStateUpdateSamples),
			},
			firstPartialMessageUpdate: {
				support: this.capabilities.firstPartialMessageUpdate,
				samples: [...this.firstPartialMessageUpdateSamples],
				stats: createRollingLatencyStats(this.firstPartialMessageUpdateSamples),
			},
			chunkToWebview: {
				support: this.capabilities.chunkToWebviewTiming,
				samples: [...this.chunkToWebviewSamples],
				stats: createRollingLatencyStats(this.chunkToWebviewSamples),
			},
			requestCounterSummaries: [...this.requestCounterSummaries],
			logs: [...this.logs],
			optionalCounters: { ...this.optionalCounters },
		}
	}

	reset(): void {
		const { branch, commit, environment, platform, label } = this.sessionMetadata
		this.sessionStartedAt = Date.now()
		this.currentObservedTaskId = undefined
		this.sessionMetadata = {
			startedAt: this.sessionStartedAt,
			branch,
			commit,
			environment,
			platform,
			label,
		}
		this.taskInitializationStarts.clear()
		this.activeRequests.clear()
		this.transportSamples.length = 0
		this.taskInitializationSamples.length = 0
		this.requestStartSamples.length = 0
		this.firstVisibleUpdateSamples.length = 0
		this.firstFullStateUpdateSamples.length = 0
		this.firstPartialMessageUpdateSamples.length = 0
		this.chunkToWebviewSamples.length = 0
		this.requestCounterSummaries.length = 0
		this.logs.length = 0
		this.optionalCounters = {
			fullStatePushes: 0,
			fullStateBytes: 0,
			partialMessageEvents: 0,
			partialMessageBytes: 0,
			taskUiDeltaEvents: 0,
			persistenceFlushes: 0,
		}
	}

	private resetForTask(taskId: string): void {
		this.reset()
		this.currentObservedTaskId = taskId
	}

	private pushLog(message: string, taskId?: string, requestId?: string): void {
		this.logs.push({
			ts: Date.now(),
			message,
			taskId,
			requestId,
		})
	}
}

let latencyObserverService: LatencyObserverService | undefined

export function getLatencyObserverService(): LatencyObserverService {
	latencyObserverService ??= new LatencyObserverService()
	return latencyObserverService
}
