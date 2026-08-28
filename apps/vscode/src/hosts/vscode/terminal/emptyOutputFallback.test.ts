import { describe, expect, it } from "bun:test"
import { shouldFallbackToTerminalSnapshot } from "./emptyOutputFallback"

describe("shouldFallbackToTerminalSnapshot", () => {
	it("does not treat a silent success as a capture failure when OSC 633 C was seen", () => {
		expect(
			shouldFallbackToTerminalSnapshot({
				capturedOutput: "",
				didSeeCommandExecuted: true,
			}),
		).toBe(false)
	})

	it("still falls back when output is empty and OSC 633 C was never seen", () => {
		expect(
			shouldFallbackToTerminalSnapshot({
				capturedOutput: "",
				didSeeCommandExecuted: false,
			}),
		).toBe(true)
	})

	it("does not fall back when output was captured", () => {
		expect(
			shouldFallbackToTerminalSnapshot({
				capturedOutput: "hello\n",
				didSeeCommandExecuted: true,
			}),
		).toBe(false)
	})

	it("treats whitespace-only output as empty", () => {
		expect(
			shouldFallbackToTerminalSnapshot({
				capturedOutput: "   \n\t",
				didSeeCommandExecuted: false,
			}),
		).toBe(true)
	})

	// The end event is not a completion signal for this decision: VS Code fires
	// onDidEndTerminalShellExecution before its debounced data reaches the stream,
	// so a fast command whose end event wins that race must still recover its
	// output rather than be reported as silent.
	//
	// The two guards below pass the options the previous implementation accepted.
	// Those fields are no longer part of the signature, so they must be inert --
	// asserting that requires calling through a loose type, because the compiler
	// now rejects them outright. Both cases returned false before this change.
	const decideWithLegacyOptions = shouldFallbackToTerminalSnapshot as unknown as (options: Record<string, unknown>) => boolean

	it("does not rely on the shell-execution end event to declare silence", () => {
		expect(
			decideWithLegacyOptions({
				capturedOutput: "",
				didSeeCommandExecuted: false,
				executionEndObserved: true,
			}),
		).toBe(true)
	})

	it("leaves the terminal-closed failure branch to the caller", () => {
		expect(
			decideWithLegacyOptions({
				capturedOutput: "",
				didSeeCommandExecuted: false,
				terminalClosed: true,
			}),
		).toBe(true)
	})
})
