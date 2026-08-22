import { describe, expect, it } from "bun:test"
import { shouldFallbackToTerminalSnapshot } from "./emptyOutputFallback"

describe("shouldFallbackToTerminalSnapshot", () => {
	it("does not treat a silent success as a capture failure when OSC 633 C was seen", () => {
		expect(
			shouldFallbackToTerminalSnapshot({
				capturedOutput: "",
				didSeeCommandExecuted: true,
				executionEndObserved: false,
				terminalClosed: false,
			}),
		).toBe(false)
	})

	it("does not treat a silent success as a capture failure when onDidEndTerminalShellExecution fired", () => {
		expect(
			shouldFallbackToTerminalSnapshot({
				capturedOutput: "",
				didSeeCommandExecuted: false,
				executionEndObserved: true,
				terminalClosed: false,
			}),
		).toBe(false)
	})

	it("does not treat a silent success as a capture failure when both completion signals were observed", () => {
		expect(
			shouldFallbackToTerminalSnapshot({
				capturedOutput: "",
				didSeeCommandExecuted: true,
				executionEndObserved: true,
				terminalClosed: false,
			}),
		).toBe(false)
	})

	it("still falls back when output is empty and completion was never observed", () => {
		expect(
			shouldFallbackToTerminalSnapshot({
				capturedOutput: "",
				didSeeCommandExecuted: false,
				executionEndObserved: false,
				terminalClosed: false,
			}),
		).toBe(true)
	})

	it("does not fall back when output was captured", () => {
		expect(
			shouldFallbackToTerminalSnapshot({
				capturedOutput: "hello\n",
				didSeeCommandExecuted: true,
				executionEndObserved: true,
				terminalClosed: false,
			}),
		).toBe(false)
	})

	it("does not use the clipboard fallback after the terminal has closed", () => {
		expect(
			shouldFallbackToTerminalSnapshot({
				capturedOutput: "",
				didSeeCommandExecuted: false,
				executionEndObserved: false,
				terminalClosed: true,
			}),
		).toBe(false)
	})
})
