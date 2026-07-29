import { describe, expect, it } from "vitest"
import { expandBuiltinSlashCommands } from "./builtin-slash-commands"

describe("expandBuiltinSlashCommands", () => {
	it("expands a leading /deep-planning into the explicit instructions", () => {
		const result = expandBuiltinSlashCommands("/deep-planning")
		expect(result.expanded).toBe(true)
		expect(result.text).toContain('<explicit_instructions type="deep-planning">')
		expect(result.text).toContain("implementation_plan.md")
		expect(result.text).not.toContain("/deep-planning")
	})

	it("preserves the user's request after the template", () => {
		const result = expandBuiltinSlashCommands("/deep-planning add a factorial function to source/math-utils.ts")
		expect(result.expanded).toBe(true)
		expect(result.text.indexOf('<explicit_instructions type="deep-planning">')).toBe(0)
		expect(result.text).toContain("add a factorial function to source/math-utils.ts")
	})

	it("expands a whitespace-preceded mid-message token", () => {
		const result = expandBuiltinSlashCommands("please /deep-planning this refactor")
		expect(result.expanded).toBe(true)
		expect(result.text).toContain("please")
		expect(result.text).toContain("this refactor")
		expect(result.text).not.toContain("/deep-planning")
	})

	it("matches case-insensitively, like webview command validation", () => {
		expect(expandBuiltinSlashCommands("/Deep-Planning").expanded).toBe(true)
	})

	it("does not match URLs, paths, or longer command names", () => {
		expect(expandBuiltinSlashCommands("see http://x.com/deep-planning").expanded).toBe(false)
		expect(expandBuiltinSlashCommands("open some/deep-planning file").expanded).toBe(false)
		expect(expandBuiltinSlashCommands("/deep-planning2").expanded).toBe(false)
	})

	it("returns unrelated text unchanged", () => {
		const result = expandBuiltinSlashCommands("hello world")
		expect(result.expanded).toBe(false)
		expect(result.text).toBe("hello world")
	})
})
