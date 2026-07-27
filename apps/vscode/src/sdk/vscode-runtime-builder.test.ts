import { describe, expect, it, vi } from "vitest"
import type { McpHub } from "@/services/mcp/McpHub"
import { createVscodeExtraTools } from "./vscode-runtime-builder"
import { VSCODE_RUN_COMMANDS_TIMEOUT_MS } from "./vscode-run-commands-tool"

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({ getGlobalSettingsKey: () => "default" }),
	},
}))

// The real telemetry proxy lazily initializes TelemetryService, which requires
// a HostProvider that unit tests don't set up.
vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

const emptyMcpHub = { getServers: () => [] } as unknown as McpHub

describe("createVscodeExtraTools", () => {
	// Regression test for ENG-2333: the extended timeout was only passed on
	// the vscodeTerminal path, so the backgroundExec default killed every
	// command at the SDK's 30s default (npm install, tests, builds).
	it.each(["vscodeTerminal", "backgroundExec"] as const)(
		"gives run_commands the extended timeout in %s mode",
		async (executionMode) => {
			const tools = await createVscodeExtraTools(emptyMcpHub, {
				cwd: "/workspace",
				getTerminalManager: () => {
					throw new Error("Terminal manager should not be created during tool construction")
				},
				vscodeTerminalExecutionMode: executionMode,
			})

			const runCommands = tools.find((tool) => tool.name === "run_commands")
			expect(runCommands).toBeDefined()
			// createShellTool sets the tool-level timeout to bashTimeoutMs * 2.
			expect(runCommands?.timeoutMs).toBe(VSCODE_RUN_COMMANDS_TIMEOUT_MS * 2)
		},
	)
})
