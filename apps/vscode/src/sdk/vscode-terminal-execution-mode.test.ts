import { describe, expect, it } from "vitest"
import { getEffectiveTerminalExecutionMode } from "./vscode-terminal-execution-mode"

describe("getEffectiveTerminalExecutionMode", () => {
	it("honors vscodeTerminal", () => {
		expect(getEffectiveTerminalExecutionMode("vscodeTerminal")).toBe("vscodeTerminal")
	})

	it("honors backgroundExec", () => {
		expect(getEffectiveTerminalExecutionMode("backgroundExec")).toBe("backgroundExec")
	})
})
