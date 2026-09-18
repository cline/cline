import { afterAll, beforeEach, describe, expect, test } from "bun:test"

const originalIsDev = process.env.IS_DEV
process.env.IS_DEV = "false"

const { Logger } = await import("./Logger")

const messages: string[] = []
Logger.subscribe((message) => messages.push(message))

describe("Logger", () => {
	beforeEach(() => {
		messages.length = 0
	})

	afterAll(() => {
		if (originalIsDev === undefined) {
			delete process.env.IS_DEV
		} else {
			process.env.IS_DEV = originalIsDev
		}
	})

	test("includes Error details without exposing other release arguments", () => {
		Logger.error("Transport error:", new Error("connection refused"), { token: "sensitive-value" })

		expect(messages).toHaveLength(1)
		expect(messages[0]).toMatch(/ ERROR Transport error: connection refused$/)
		expect(messages[0]).not.toContain("sensitive-value")
	})

	test("keeps non-Error arguments out of release logs", () => {
		Logger.error("Request failed:", { detail: "sensitive-value" })

		expect(messages).toHaveLength(1)
		expect(messages[0]).toMatch(/ ERROR Request failed:$/)
		expect(messages[0]).not.toContain("sensitive-value")
	})

	test("keeps Error details out of non-error release logs", () => {
		Logger.log("Request details:", new Error("sensitive-value"))

		expect(messages).toHaveLength(1)
		expect(messages[0]).toMatch(/ LOG Request details:$/)
		expect(messages[0]).not.toContain("sensitive-value")
	})
})
