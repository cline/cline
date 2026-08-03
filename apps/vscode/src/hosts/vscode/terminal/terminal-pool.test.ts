import { describe, expect, it } from "vitest"
import {
	BUSY_TIMEOUT_MS,
	type EvictableTerminal,
	MAX_TERMINALS,
	selectTerminalsToEvict,
	shouldAutoReleaseBusy,
} from "./terminal-pool"

function terminal(id: number, lastActive: number, isHot = false): EvictableTerminal {
	return { id, lastActive, isHot }
}

describe("terminal-pool", () => {
	describe("selectTerminalsToEvict (LRU, V15 §5)", () => {
		it("returns nothing below the cap", () => {
			const pool = [terminal(1, 10), terminal(2, 20), terminal(3, 30)]
			expect(selectTerminalsToEvict(pool, 10)).toEqual([])
		})

		it("evicts the least-recently-active idle terminals once the cap is hit", () => {
			// 12 tracked terminals, cap 10 → evict down to MAX-1 before the new
			// terminal is created, so 3 oldest idle terminals are evicted.
			const pool = Array.from({ length: 12 }, (_, i) => terminal(i + 1, (i + 1) * 1000))
			const evicted = selectTerminalsToEvict(pool, 10)
			expect(evicted.map((t) => t.id)).toEqual([1, 2, 3])
		})

		it("skips hot terminals (active output) even when they are the oldest", () => {
			const pool = [
				terminal(1, 1_000, true), // oldest but still producing output (dev server)
				terminal(2, 2_000),
				terminal(3, 3_000),
				terminal(4, 4_000),
				terminal(5, 5_000),
				terminal(6, 6_000),
				terminal(7, 7_000),
				terminal(8, 8_000),
				terminal(9, 9_000),
				terminal(10, 10_000),
				terminal(11, 11_000),
			]
			const evicted = selectTerminalsToEvict(pool, 10)
			// ids 1 (hot) and 2 are beyond the cap; hot 1 is preserved, 2 evicted.
			expect(evicted.map((t) => t.id)).toEqual([2])
		})

		it("returns [] when everything beyond the cap is hot", () => {
			const pool = Array.from({ length: 12 }, (_, i) => terminal(i + 1, (i + 1) * 1000, true))
			expect(selectTerminalsToEvict(pool, 10)).toEqual([])
		})

		it("sorts eviction candidates strictly by lastActive (stable LRU order)", () => {
			const pool = [
				terminal(5, 5_000),
				terminal(1, 1_000),
				terminal(3, 3_000),
				terminal(2, 2_000),
				terminal(4, 4_000),
				terminal(6, 6_000),
				terminal(7, 7_000),
				terminal(8, 8_000),
				terminal(9, 9_000),
				terminal(10, 10_000),
				terminal(11, 11_000),
			]
			const evicted = selectTerminalsToEvict(pool, 10)
			// 11 tracked → evict the 2 least-recently-active (ids 1 and 2).
			expect(evicted.map((t) => t.id)).toEqual([1, 2])
		})

		it("enforces the documented default cap of 10", () => {
			expect(MAX_TERMINALS).toBe(10)
		})
	})

	describe("shouldAutoReleaseBusy (5-minute guard, V15 §5)", () => {
		it("releases a stuck busy terminal after the timeout", () => {
			expect(shouldAutoReleaseBusy(true, BUSY_TIMEOUT_MS, false)).toBe(true)
			expect(shouldAutoReleaseBusy(true, BUSY_TIMEOUT_MS + 1, false)).toBe(true)
		})

		it("does not release before the timeout elapses", () => {
			expect(shouldAutoReleaseBusy(true, BUSY_TIMEOUT_MS - 1, false)).toBe(false)
		})

		it("defers release while the terminal is still producing output (hot)", () => {
			expect(shouldAutoReleaseBusy(true, BUSY_TIMEOUT_MS, true)).toBe(false)
		})

		it("never releases a non-busy terminal", () => {
			expect(shouldAutoReleaseBusy(false, BUSY_TIMEOUT_MS, false)).toBe(false)
		})

		it("is exactly 5 minutes", () => {
			expect(BUSY_TIMEOUT_MS).toBe(5 * 60 * 1000)
		})
	})
})
