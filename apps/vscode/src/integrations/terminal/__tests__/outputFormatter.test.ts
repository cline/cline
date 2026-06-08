import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { formatTerminalOutput } from "../outputFormatter"

describe("formatTerminalOutput", () => {
	it("preserves normal CRLF output as lines", () => {
		const result = formatTerminalOutput(["one\r\ntwo", "three"], 10)

		assert.equal(result, "one\ntwo\nthree")
	})

	it("truncates carriage-return progress updates by output line limit", () => {
		const progress = Array.from({ length: 1_000 }, (_, index) => `Frame ${index} spheres=14752 elapsed=900s`).join("\r")

		const result = formatTerminalOutput([progress], 10)

		assert.match(result, /\.\.\. \(output truncated\) \.\.\./)
		assert.equal(result.match(/Frame \d+ spheres=/g)?.length, 10)
	})

	it("caps a single oversized terminal line", () => {
		const result = formatTerminalOutput([`start ${"x".repeat(10_000)} end`], 10)

		assert.match(result, /\.\.\. \(line truncated, \d+ chars omitted\) \.\.\./)
		assert.ok(result.length <= 4_096)
		assert.ok(result.startsWith("start "))
		assert.ok(result.endsWith(" end"))
	})

	it("caps total command output after line truncation", () => {
		const lines = Array.from({ length: 2_000 }, (_, index) => `line ${index} ${"x".repeat(100)}`)

		const result = formatTerminalOutput(lines, 2_000)

		assert.match(result, /\.\.\. \(command output truncated, \d+ chars omitted\) \.\.\./)
		assert.ok(result.length <= 65_536)
	})
})
