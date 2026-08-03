import { describe, expect, it, vi } from "vitest"
import { buildInjectScript, parseArgs } from "./run-scroll-benchmark"

describe("parseArgs (headless CLI parsing)", () => {
	it("applies defaults when no flags are given", () => {
		const args = parseArgs([])
		expect(args.messages).toBe(100)
		expect(args.durationMs).toBe(3000)
		expect(args.port).toBe(19229)
		expect(args.budgetMB).toBe(200)
		expect(args.minP95Fps).toBe(30)
		expect(args.maxJankRate).toBe(0.1)
	})

	it("overrides flags in order", () => {
		const args = parseArgs(["--messages", "250", "--duration", "5000", "--budget-mb", "300", "--port", "19999"])
		expect(args.messages).toBe(250)
		expect(args.durationMs).toBe(5000)
		expect(args.budgetMB).toBe(300)
		expect(args.port).toBe(19999)
	})

	it("warns on unknown flags but keeps parsing", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const args = parseArgs(["--nope", "1", "--messages", "50"])
		expect(warn).toHaveBeenCalled()
		expect(args.messages).toBe(50)
		warn.mockRestore()
	})
})

describe("buildInjectScript (webview injection template)", () => {
	it("injects the requested message count and duration", () => {
		const script = buildInjectScript(120, 4000)
		expect(script).toContain("const target = 120;")
		expect(script).toContain("const duration = 4000;")
		expect(script).toContain("i < target; i++")
	})

	it("emits a single IIFE expression (web.evaluate contract)", () => {
		const script = buildInjectScript(10, 1000)
		expect(script.trimStart().startsWith("(() => {")).toBe(true)
		expect(script.trimEnd().endsWith("})()")).toBe(true)
		// No stray statement separators outside the IIFE.
		expect(script.trimStart().startsWith("(() => {")).toBe(true)
	})

	it("marks each synthetic row with the benchmark data attribute", () => {
		const script = buildInjectScript(5, 500)
		expect(script).toContain('row.setAttribute("data-benchmark-message", String(i))')
		expect(script).toContain("scroller.scrollTop = Math.round(t * max)")
		expect(script).toContain("window.__clineBench = { frames, memory, scrollHeight: scroller.scrollHeight }")
	})

	it("handles large message counts without truncation", () => {
		const script = buildInjectScript(1000, 2000)
		expect(script).toContain("const target = 1000;")
		expect(script).toContain('row.textContent = "Synthetic message " + i')
	})
})
