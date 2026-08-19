import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getEffectiveTerminalExecutionMode } from "./vscode-terminal-execution-mode"

describe("getEffectiveTerminalExecutionMode", () => {
	const originalIsStandalone = process.env.IS_STANDALONE

	beforeEach(() => {
		delete process.env.IS_STANDALONE
	})

	afterEach(() => {
		if (originalIsStandalone === undefined) {
			delete process.env.IS_STANDALONE
		} else {
			process.env.IS_STANDALONE = originalIsStandalone
		}
	})

	it("honors vscodeTerminal on the real VS Code host (IS_STANDALONE unset)", () => {
		expect(getEffectiveTerminalExecutionMode("vscodeTerminal")).toBe("vscodeTerminal")
	})

	it("honors vscodeTerminal on the real VS Code host (IS_STANDALONE=false)", () => {
		process.env.IS_STANDALONE = "false"
		expect(getEffectiveTerminalExecutionMode("vscodeTerminal")).toBe("vscodeTerminal")
	})

	it("clamps vscodeTerminal to backgroundExec on the standalone (JetBrains/CLI) build", () => {
		process.env.IS_STANDALONE = "true"
		expect(getEffectiveTerminalExecutionMode("vscodeTerminal")).toBe("backgroundExec")
	})

	it("leaves backgroundExec unchanged regardless of host", () => {
		process.env.IS_STANDALONE = "true"
		expect(getEffectiveTerminalExecutionMode("backgroundExec")).toBe("backgroundExec")
	})
})
