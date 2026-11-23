import { describe, expect, it } from "vitest"
import { isTaskCostAvailable } from "./TaskHeader"

describe("TaskHeader cost badge", () => {
	it("hides the cost of a cloud task until the sandbox has reported usage", () => {
		// The local provider would show a cost, but nothing about a cloud task's
		// charge is known yet; $0.0000 would read as a confirmed zero.
		expect(isTaskCostAvailable({ isCloudTask: true, cloudUsageAvailable: undefined, localCostAvailable: true })).toBe(false)
		expect(isTaskCostAvailable({ isCloudTask: true, cloudUsageAvailable: false, localCostAvailable: true })).toBe(false)
	})

	it("shows a cloud task's cost once the sandbox has reported usage, whatever the local provider is", () => {
		expect(isTaskCostAvailable({ isCloudTask: true, cloudUsageAvailable: true, localCostAvailable: false })).toBe(true)
	})

	it("leaves local tasks on the local provider's cost display", () => {
		expect(isTaskCostAvailable({ isCloudTask: false, cloudUsageAvailable: undefined, localCostAvailable: true })).toBe(true)
		expect(isTaskCostAvailable({ isCloudTask: false, cloudUsageAvailable: undefined, localCostAvailable: false })).toBe(false)
	})
})
