import { describe, expect, it } from "vitest"
import { ensureDebugTaskUiCounters, incrementDebugTaskUiCounter } from "./taskUiDebugCounters"

describe("taskUiDebugCounters", () => {
	it("does not initialize counters outside development mode", () => {
		const targetWindow = {} as Window
		expect(ensureDebugTaskUiCounters(false, targetWindow)).toBeUndefined()
		expect(targetWindow.__CLINE_DEBUG_TASK_UI_COUNTERS__).toBeUndefined()
	})

	it("initializes counters once in development mode", () => {
		const targetWindow = {} as Window
		const first = ensureDebugTaskUiCounters(true, targetWindow)
		const second = ensureDebugTaskUiCounters(true, targetWindow)

		expect(first).toEqual({
			fullStateApplications: 0,
			partialMessageApplications: 0,
			taskUiDeltaApplications: 0,
			taskUiDeltaResyncRequests: 0,
		})
		expect(second).toBe(first)
	})

	it("increments a named counter in development mode", () => {
		const targetWindow = {} as Window
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
