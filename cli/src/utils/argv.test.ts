import { describe, expect, it } from "vitest"
import { normalizeCliArgvForPrompt } from "./argv"

describe("normalizeCliArgvForPrompt", () => {
	it("inserts -- before dash-prefixed prose prompt", () => {
		const input = ["node", "cline", "-y", "--verbose", "- You are given a task"]
		const output = normalizeCliArgvForPrompt(input)
		expect(output).toEqual(["node", "cline", "-y", "--verbose", "--", "- You are given a task"])
	})

	it("does not modify argv when -- is already present", () => {
		const input = ["node", "cline", "-y", "--", "- You are given a task"]
		const output = normalizeCliArgvForPrompt(input)
		expect(output).toEqual(input)
	})

	it("does not modify normal option-style tokens", () => {
		const input = ["node", "cline", "-y", "--verbose", "build project"]
		const output = normalizeCliArgvForPrompt(input)
		expect(output).toEqual(input)
	})
})
