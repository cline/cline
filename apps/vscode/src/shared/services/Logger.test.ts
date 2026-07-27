import { describe, expect, it } from "bun:test"
import { sanitizeLogMessage } from "./Logger"

describe("sanitizeLogMessage", () => {
	it("redacts prompts, commands, credentials, and workspace paths", () => {
		const value = sanitizeLogMessage('prompt="private source" command=curl C:\\work\\secret.ts Bearer abcdefghijklmnop')
		expect(value).not.toContain("private source")
		expect(value).not.toContain("curl")
		expect(value).not.toContain("C:\\work\\secret.ts")
		expect(value).not.toContain("abcdefghijklmnop")
		expect(value).toContain("[REDACTED]")
	})

	it("keeps operational state messages readable", () => {
		expect(sanitizeLogMessage("[BedrockStartup] discovering region=us-east-1")).toBe(
			"[BedrockStartup] discovering region=us-east-1",
		)
	})
})
