export type DebugTaskUiCounters = {
	fullStateApplications: number
	partialMessageApplications: number
	taskUiDeltaApplications: number
	taskUiDeltaResyncRequests: number
}

export type DebugTaskUiCounterKey = keyof DebugTaskUiCounters

declare global {
	interface Window {
		__CLINE_DEBUG_TASK_UI_COUNTERS__?: DebugTaskUiCounters
	}
}

export function ensureDebugTaskUiCounters(isDev: boolean, targetWindow: Window | undefined): DebugTaskUiCounters | undefined {
	if (!isDev || !targetWindow) {
		return undefined
	}

	targetWindow.__CLINE_DEBUG_TASK_UI_COUNTERS__ ??= {
		fullStateApplications: 0,
		partialMessageApplications: 0,
		taskUiDeltaApplications: 0,
		taskUiDeltaResyncRequests: 0,
	}

	return targetWindow.__CLINE_DEBUG_TASK_UI_COUNTERS__
}

export function incrementDebugTaskUiCounter(
	isDev: boolean,
	targetWindow: Window | undefined,
	key: DebugTaskUiCounterKey,
): DebugTaskUiCounters | undefined {
	const counters = ensureDebugTaskUiCounters(isDev, targetWindow)
	if (!counters) {
		return undefined
	}

	counters[key] += 1
	return counters
}
