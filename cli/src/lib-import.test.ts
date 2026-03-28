import { describe, expect, it } from "vitest"

describe("library import side effects", () => {
	it("importing library exports must not mutate console.log", async () => {
		const originalConsoleLog = console.log
		await import("./exports")
		expect(console.log).toBe(originalConsoleLog)
	}, 30000)
})
