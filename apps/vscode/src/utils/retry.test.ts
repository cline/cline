import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { retryOperation } from "./retry"

const originalSetTimeout = globalThis.setTimeout
const deadlines: ReturnType<typeof setTimeout>[] = []

function captureDeadlines() {
	spyOn(globalThis, "setTimeout").mockImplementation((...args: Parameters<typeof setTimeout>) => {
		const timer = originalSetTimeout(...args)
		deadlines.push(timer)
		return timer
	})
}

afterEach(() => {
	for (const timer of deadlines) clearTimeout(timer)
	deadlines.length = 0
	mock.restore()
})

describe("retryOperation", () => {
	it("clears the deadline after success", async () => {
		captureDeadlines()
		expect(await retryOperation(1, 10_000, async () => "ok")).toBe("ok")
		expect(deadlines).toHaveLength(1)
		expect(deadlines[0].hasRef()).toBe(false)
	})

	it("clears the deadline after a rejected operation", async () => {
		captureDeadlines()
		await expect(
			retryOperation(1, 10_000, async () => {
				throw new Error("failed")
			}),
		).rejects.toThrow("Operation failed after 1 attempts: failed")
		expect(deadlines[0].hasRef()).toBe(false)
	})

	it("clears the deadline when the operation throws synchronously", async () => {
		captureDeadlines()
		await expect(
			retryOperation(1, 10_000, () => {
				throw new Error("sync failure")
			}),
		).rejects.toThrow("sync failure")
		expect(deadlines[0].hasRef()).toBe(false)
	})

	it("still times out an operation that never settles", async () => {
		await expect(retryOperation(1, 5, () => new Promise(() => {}))).rejects.toThrow("Operation timeout")
	})

	it("still retries after a failed attempt", async () => {
		captureDeadlines()
		let attempts = 0
		expect(
			await retryOperation(2, 10_000, async () => {
				attempts += 1
				if (attempts === 1) throw new Error("retry")
				return "ok"
			}),
		).toBe("ok")
		expect(attempts).toBe(2)
		expect(deadlines.every((timer) => !timer.hasRef())).toBe(true)
	})
})
