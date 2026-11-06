import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { UsageTracker } from "./usage-tracker"

describe("UsageTracker", () => {
	let tmpDir: string
	let tracker: UsageTracker

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-tracker-test-"))
		tracker = new UsageTracker(tmpDir)
	})

	afterEach(() => {
		tracker.dispose()
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	function todayUTC(): string {
		return new Date().toISOString().slice(0, 10)
	}

	describe("recordUsage", () => {
		test("creates today's entry on first call", () => {
			tracker.recordUsage({ tokensIn: 100, tokensOut: 50 })
			tracker.dispose() // flush to disk

			const all = tracker.getAll()
			expect(all).toHaveLength(1)
			expect(all[0].date).toBe(todayUTC())
			expect(all[0].tokensIn).toBe(100)
			expect(all[0].tokensOut).toBe(50)
			expect(all[0].cacheReads).toBe(0)
			expect(all[0].cacheWrites).toBe(0)
			expect(all[0].totalCost).toBe(0)
			expect(all[0].apiCalls).toBe(1)
		})

		test("accumulates on subsequent calls same day", () => {
			tracker.recordUsage({ tokensIn: 100, tokensOut: 50, totalCost: 0.01 })
			tracker.recordUsage({ tokensIn: 200, tokensOut: 100, totalCost: 0.02 })
			tracker.dispose() // flush to disk

			const all = tracker.getAll()
			expect(all).toHaveLength(1)
			expect(all[0].tokensIn).toBe(300)
			expect(all[0].tokensOut).toBe(150)
			expect(all[0].totalCost).toBeCloseTo(0.03)
			expect(all[0].apiCalls).toBe(2)
		})

		test("tracks cacheReads and cacheWrites", () => {
			tracker.recordUsage({ tokensIn: 100, tokensOut: 50, cacheReads: 500, cacheWrites: 100 })
			tracker.dispose() // flush to disk

			const all = tracker.getAll()
			expect(all[0].cacheReads).toBe(500)
			expect(all[0].cacheWrites).toBe(100)
		})

		test("tracks per-model breakdown", () => {
			tracker.recordUsage({ tokensIn: 100, tokensOut: 50, modelId: "claude-sonnet-4" })
			tracker.recordUsage({ tokensIn: 200, tokensOut: 100, modelId: "claude-haiku-4" })
			tracker.recordUsage({ tokensIn: 50, tokensOut: 25, modelId: "claude-sonnet-4" })
			tracker.dispose() // flush to disk

			const all = tracker.getAll()
			const byModel = all[0].byModel!
			expect(Object.keys(byModel)).toHaveLength(2)
			expect(byModel["claude-sonnet-4"].tokensIn).toBe(150)
			expect(byModel["claude-sonnet-4"].apiCalls).toBe(2)
			expect(byModel["claude-haiku-4"].tokensIn).toBe(200)
			expect(byModel["claude-haiku-4"].apiCalls).toBe(1)
		})

		test("uses 'unknown' as modelId when not provided", () => {
			tracker.recordUsage({ tokensIn: 100, tokensOut: 50 })
			tracker.dispose() // flush to disk

			const all = tracker.getAll()
			const byModel = all[0].byModel!
			expect(byModel["unknown"].tokensIn).toBe(100)
		})

		test("persists to disk after debounce", async () => {
			tracker.recordUsage({ tokensIn: 100, tokensOut: 50 })

			// Wait for debounce to fire
			await new Promise((r) => setTimeout(r, 600))

			const filePath = path.join(tmpDir, "usage", "daily-usage.json")
			expect(fs.existsSync(filePath)).toBe(true)
			const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"))
			expect(raw).toHaveLength(1)
			expect(raw[0].tokensIn).toBe(100)
		})

		test("dispose flushes pending writes immediately", () => {
			tracker.recordUsage({ tokensIn: 100, tokensOut: 50 })
			tracker.dispose() // flushes immediately

			const filePath = path.join(tmpDir, "usage", "daily-usage.json")
			expect(fs.existsSync(filePath)).toBe(true)
		})
	})

	describe("getAll", () => {
		test("returns empty array when no data", () => {
			expect(tracker.getAll()).toEqual([])
		})

		test("handles missing file gracefully", () => {
			const all = tracker.getAll()
			expect(all).toEqual([])
		})

		test("handles corrupt file gracefully", () => {
			const usageDir = path.join(tmpDir, "usage")
			fs.mkdirSync(usageDir, { recursive: true })
			fs.writeFileSync(path.join(usageDir, "daily-usage.json"), "not json{{{")

			const all = tracker.getAll()
			expect(all).toEqual([])
		})
	})
})
