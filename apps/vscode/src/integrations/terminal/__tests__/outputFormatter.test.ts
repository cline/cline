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

	it("handles a one-line output limit without tail lines", () => {
		const result = formatTerminalOutput(["first", "second", "third"], 1)

		assert.equal(result, "first\n... (output truncated) ...")
	})

	it("caps a single oversized terminal line", () => {
		const result = formatTerminalOutput([`start ${"x".repeat(10_000)} end`], 10)

		assert.match(result, /\.\.\. \(line truncated, \d+ chars omitted\) \.\.\./)
		assert.ok(result.length <= 4_096)
		assert.ok(result.startsWith("start "))
		assert.ok(result.endsWith(" end"))
	})

	it("strictly caps oversized terminal lines across omitted-count digit boundaries", () => {
		for (const extraChars of [9, 10, 99, 100, 999, 1_000]) {
			const result = formatTerminalOutput(["x".repeat(4_096 + extraChars)], 10)

			assert.ok(result.length <= 4_096, `expected ${result.length} <= 4096 for ${extraChars} extra chars`)
		}
	})

	it("caps total command output after line truncation", () => {
		const lines = Array.from({ length: 2_000 }, (_, index) => `line ${index} ${"x".repeat(100)}`)

		const result = formatTerminalOutput(lines, 2_000)

		assert.match(result, /\.\.\. \(command output truncated, \d+ chars omitted\) \.\.\./)
		assert.ok(result.length <= 65_536)
	})
})
