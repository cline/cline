import { describe, expect, it } from "vitest"
import { createOptimisticModeTracker } from "./optimisticMode"

describe("createOptimisticModeTracker", () => {
	it("passes snapshots through untouched when no switch is in flight", () => {
		const tracker = createOptimisticModeTracker("act")

		expect(tracker.reconcile("act")).toBe("act")
		expect(tracker.reconcile("plan")).toBe("plan")
	})

	it("falls back to the last reported mode for a snapshot without one", () => {
		const tracker = createOptimisticModeTracker("act")

		tracker.reconcile("plan")

		expect(tracker.reconcile(undefined)).toBe("plan")
	})

	it("holds the target mode while snapshots still carry the old one", () => {
		const tracker = createOptimisticModeTracker("act")
		tracker.begin("plan")

		// Snapshots emitted mid-rebuild (or in flight before the toggle) must not
		// bounce the toggle back to Act.
		expect(tracker.reconcile("act")).toBe("plan")
		expect(tracker.reconcile("act")).toBe("plan")
	})

	it("stops overriding once a snapshot confirms the target mode", () => {
		const tracker = createOptimisticModeTracker("act")
		const settle = tracker.begin("plan")

		expect(tracker.reconcile("plan")).toBe("plan")
		// Confirmed, so the override is gone and later snapshots win outright.
		expect(tracker.reconcile("act")).toBe("act")
		expect(settle()).toBeNull()
	})

	it("reports no change when settling a switch the extension confirmed", () => {
		const tracker = createOptimisticModeTracker("act")
		const settle = tracker.begin("plan")
		tracker.reconcile("plan")

		expect(settle()).toBeNull()
	})

	it("snaps back to the reported mode when the extension rolled the switch back", () => {
		const tracker = createOptimisticModeTracker("act")
		const settle = tracker.begin("plan")

		// The rebuild failed, so the extension re-posted the mode it kept running.
		expect(tracker.reconcile("act")).toBe("plan")

		expect(settle()).toBe("act")
		// Override released: subsequent snapshots are authoritative again.
		expect(tracker.reconcile("act")).toBe("act")
	})

	it("keeps the optimistic mode when no snapshot arrived to contradict it", () => {
		const tracker = createOptimisticModeTracker("act")
		const settle = tracker.begin("plan")

		// Reverting to the stale pre-switch mode here would flicker the toggle
		// back before the extension's snapshot lands.
		expect(settle()).toBeNull()
		// Override released, so the next snapshot is authoritative either way.
		expect(tracker.reconcile("plan")).toBe("plan")
	})

	it("ignores a stale settle so a newer switch keeps its optimistic mode", () => {
		const tracker = createOptimisticModeTracker("act")
		const settleFirst = tracker.begin("plan")
		const settleSecond = tracker.begin("act")

		expect(settleFirst()).toBeNull()
		// The second switch still owns the override.
		expect(tracker.reconcile("plan")).toBe("act")
		expect(settleSecond()).toBe("plan")
	})

	it("ignores a repeated settle for the same switch", () => {
		const tracker = createOptimisticModeTracker("act")
		const settle = tracker.begin("plan")
		tracker.reconcile("act")

		expect(settle()).toBe("act")
		expect(settle()).toBeNull()
	})
})
