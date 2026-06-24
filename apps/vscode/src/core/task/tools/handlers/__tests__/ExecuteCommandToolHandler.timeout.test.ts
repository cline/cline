import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { ExecuteCommandToolHandler, isLikelyLongRunningCommand, resolveCommandTimeoutSeconds } from "../ExecuteCommandToolHandler"

type ExecuteCommandCallback = (command: string, timeoutSeconds?: number) => Promise<[boolean, string]>

function createConfig(modelId: string, executeCommandTool: ExecuteCommandCallback, yoloMode = false) {
	return {
		ulid: "test-ulid",
		taskId: "test-task",
		cwd: "/repo",
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: yoloMode,
		doubleCheckCompletionEnabled: false,
		vscodeTerminalExecutionMode: "vscodeTerminal",
		enableParallelToolCalling: false,
		isSubagentExecution: false,
		taskState: {
			consecutiveMistakeCount: 0,
			didRejectTool: false,
			abort: false,
			fileReadCache: new Map(),
			userMessageContent: [],
		},
		api: {
			getModel: () => ({ id: modelId }),
		},
		services: {
			stateManager: {
				getApiConfiguration: () => ({}),
				getGlobalSettingsKey: (key: string) => (key === "hooksEnabled" ? false : "act"),
			},
			commandPermissionController: {
				validateCommand: () => ({ allowed: true }),
			},
			clineIgnoreController: {
				validateCommand: () => undefined,
			},
		},
		autoApprover: {
			shouldAutoApproveTool: () => [true, false],
		},
		autoApprovalSettings: {
			enableNotifications: false,
		},
		callbacks: {
			removeLastPartialMessageIfExistsWithType: async () => undefined,
			say: async () => undefined,
			executeCommandTool,
		},
	} as any
}

describe("ExecuteCommandToolHandler timeout policy", () => {
	it("returns undefined when managed timeout is disabled", () => {
		const timeout = resolveCommandTimeoutSeconds("npm test", undefined, false)
		assert.equal(timeout, undefined)
	})

	it("uses explicit timeout when provided", () => {
		const timeout = resolveCommandTimeoutSeconds("npm test", "45", true)
		assert.equal(timeout, 45)
	})

	it("falls back to default timeout for short commands", () => {
		const timeout = resolveCommandTimeoutSeconds("ls -la", undefined, true)
		assert.equal(timeout, 30)
	})

	it("uses extended timeout for known long-running commands", () => {
		const timeout = resolveCommandTimeoutSeconds("npm run build", undefined, true)
		assert.equal(timeout, 300)
	})

	it("detects common long-running command families", () => {
		assert.equal(isLikelyLongRunningCommand("cargo build --release"), true)
		assert.equal(isLikelyLongRunningCommand("docker build ."), true)
		assert.equal(isLikelyLongRunningCommand("pytest -q"), true)
	})

	it("decodes escaped shell operators for non-Claude models before execution", async () => {
		let executedCommand = ""
		let executionTimeout: number | undefined
		const handler = new ExecuteCommandToolHandler({} as any)
		const config = createConfig(
			"xai/grok-4-1-fast-reasoning",
			async (command: string, timeoutSeconds?: number) => {
				executedCommand = command
				executionTimeout = timeoutSeconds
				return [false, "ok"]
			},
			true,
		)

		await handler.execute(config, {
			name: "execute_command",
			params: {
				command: "echo first &amp;&amp; echo second 2&gt;/tmp/out",
				requires_approval: "false",
			},
			isNativeToolCall: false,
		} as any)

		assert.equal(executedCommand, "echo first && echo second 2>/tmp/out")
		assert.equal(executionTimeout, 30)
	})

	it("keeps Claude command text unchanged", async () => {
		let executedCommand = ""
		const handler = new ExecuteCommandToolHandler({} as any)
		const config = createConfig("claude-3-5-sonnet-20241022", async (command: string) => {
			executedCommand = command
			return [false, "ok"]
		})

		await handler.execute(config, {
			name: "execute_command",
			params: {
				command: "echo first &amp;&amp; echo second",
				requires_approval: "false",
			},
			isNativeToolCall: false,
		} as any)

		assert.equal(executedCommand, "echo first &amp;&amp; echo second")
	})

	it("uses decoded commands for timeout heuristics", async () => {
		let executionTimeout: number | undefined
		const handler = new ExecuteCommandToolHandler({} as any)
		const config = createConfig(
			"xai/grok-4-1-fast-reasoning",
			async (_command: string, timeoutSeconds?: number) => {
				executionTimeout = timeoutSeconds
				return [false, "ok"]
			},
			true,
		)

		await handler.execute(config, {
			name: "execute_command",
			params: {
				command: "npm run build &amp;&amp; npm test",
				requires_approval: "false",
			},
			isNativeToolCall: false,
		} as any)

		assert.equal(executionTimeout, 300)
	})
})
