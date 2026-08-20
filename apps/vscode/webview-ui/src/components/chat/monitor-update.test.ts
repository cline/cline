import { describe, expect, it } from "vitest"
import { formatMonitorUpdateExit, parseMonitorUpdate } from "./monitor-update"

describe("parseMonitorUpdate", () => {
	it("parses a well-formed payload", () => {
		expect(
			parseMonitorUpdate(
				JSON.stringify({
					name: "applog",
					description: "watching",
					lines: ["one", "two"],
					droppedLines: 3,
				}),
			),
		).toEqual({
			name: "applog",
			description: "watching",
			lines: ["one", "two"],
			droppedLines: 3,
			exit: undefined,
		})
	})

	it("rejects malformed payloads instead of throwing", () => {
		expect(parseMonitorUpdate(undefined)).toBeUndefined()
		expect(parseMonitorUpdate("not json")).toBeUndefined()
		expect(parseMonitorUpdate(JSON.stringify({ lines: ["x"] }))).toBeUndefined()
		expect(parseMonitorUpdate(JSON.stringify({ name: "a" }))).toBeUndefined()
	})
})

describe("formatMonitorUpdateExit", () => {
	it("mirrors the CLI wording", () => {
		expect(formatMonitorUpdateExit({ status: "stopped", stoppedBy: "user" })).toBe("stopped by you")
		expect(formatMonitorUpdateExit({ status: "stopped" })).toBe("stopped")
		expect(formatMonitorUpdateExit({ status: "failed", error: "boom" })).toBe("failed: boom")
		expect(formatMonitorUpdateExit({ status: "exited", code: 1 })).toBe("ended with exit code 1")
		expect(formatMonitorUpdateExit({ status: "exited" })).toBe("ended")
	})
})
