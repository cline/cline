import { describe, expect, it } from "vitest"
import { type DebugTaskUiCounters, ensureDebugTaskUiCounters, incrementDebugTaskUiCounter } from "./taskUiDebugCounters"

describe("taskUiDebugCounters", () => {
	it("returns undefined when debug mode is disabled or window is absent", () => {
		expect(ensureDebugTaskUiCounters(false, window)).toBeUndefined()
		expect(ensureDebugTaskUiCounters(true, undefined)).toBeUndefined()
	})

	it("initializes counters once and increments individual keys", () => {
		const targetWindow = window as Window & { __CLINE_DEBUG_TASK_UI_COUNTERS__?: DebugTaskUiCounters }
		delete targetWindow.__CLINE_DEBUG_TASK_UI_COUNTERS__

		const counters = ensureDebugTaskUiCounters(true, targetWindow)
		expect(counters).toEqual({
			fullStateApplications: 0,
			partialMessageApplications: 0,
			taskUiDeltaApplications: 0,
			taskUiDeltaResyncRequests: 0,
		})

		incrementDebugTaskUiCounter(true, targetWindow, "taskUiDeltaApplications")
		incrementDebugTaskUiCounter(true, targetWindow, "taskUiDeltaApplications")
		incrementDebugTaskUiCounter(true, targetWindow, "taskUiDeltaResyncRequests")

		expect(targetWindow.__CLINE_DEBUG_TASK_UI_COUNTERS__).toEqual({
			fullStateApplications: 0,
			partialMessageApplications: 0,
			taskUiDeltaApplications: 2,
			taskUiDeltaResyncRequests: 1,
		})
	})
})
