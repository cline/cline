import assert from "node:assert/strict"
import { describe, it } from "mocha"
import sinon from "sinon"
import type { ToolUse } from "../../../../assistant-message"
import type { TaskConfig } from "../../types/TaskConfig"
import {
	commandRejectionKey,
	ExecuteCommandToolHandler,
	isLikelyLongRunningCommand,
	resolveCommandTimeoutSeconds,
} from "../ExecuteCommandToolHandler"

function block(command: string): ToolUse {
	return {
		type: "tool_use",
		name: "execute_command",
		params: { command, requires_approval: "true" },
		partial: false,
	} as ToolUse
}

function config(options?: { response?: "yesButtonClicked" | "noButtonClicked"; auto?: [boolean, boolean] }) {
	const state = {
		didRejectTool: false,
		rejectedCommands: new Set<string>(),
		fileReadCache: new Map(),
	} as {
		didRejectTool: boolean
		rejectedCommands: Set<string>
		fileReadCache: Map<string, unknown>
	}
	const callbacks = {
		say: sinon.stub().resolves(undefined),
		ask: sinon.stub().resolves({ response: options?.response ?? "yesButtonClicked" }),
		saveCheckpoint: sinon.stub().resolves(),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
		executeCommandTool: sinon.stub().resolves([false, "executed"]),
		cancelRunningCommandTool: sinon.stub().resolves(false),
		doesLatestTaskCompletionHaveNewChanges: sinon.stub().resolves(false),
		updateFCListFromToolResponse: sinon.stub().resolves(),
		shouldAutoApproveTool: sinon.stub().returns(false),
		shouldAutoApproveToolWithPath: sinon.stub().resolves(false),
		postStateToWebview: sinon.stub().resolves(),
		reinitExistingTaskFromId: sinon.stub().resolves(),
		cancelTask: sinon.stub().resolves(),
		updateTaskHistory: sinon.stub().resolves([]),
		applyLatestBrowserSettings: sinon.stub().resolves(undefined),
		switchToActMode: sinon.stub().resolves(false),
		setActiveHookExecution: sinon.stub().resolves(),
		clearActiveHookExecution: sinon.stub().resolves(),
		getActiveHookExecution: sinon.stub().resolves(undefined),
		runUserPromptSubmitHook: sinon.stub().resolves({}),
	}

	return {
		callbacks,
		state,
		config: {
			taskId: "task-1",
			ulid: "ulid-1",
			cwd: "/tmp",
			mode: "act",
			strictPlanModeEnabled: false,
			yoloModeToggled: false,
			doubleCheckCompletionEnabled: false,
			vscodeTerminalExecutionMode: "vscodeTerminal",
			enableParallelToolCalling: true,
			isSubagentExecution: false,
			taskState: state,
			messageState: {},
			api: { getModel: () => ({ id: "test-model" }) },
			services: {
				stateManager: {
					getGlobalSettingsKey: (key: string) => (key === "mode" ? "act" : key === "hooksEnabled" ? false : undefined),
					getApiConfiguration: () => ({
						actModeApiProvider: "test-provider",
						planModeApiProvider: "test-provider",
					}),
				},
				commandPermissionController: { validateCommand: sinon.stub().returns({ allowed: true }) },
				clineIgnoreController: { validateCommand: sinon.stub().returns(undefined) },
			},
			autoApprovalSettings: { enableNotifications: false },
			autoApprover: { shouldAutoApproveTool: sinon.stub().returns(options?.auto ?? [false, false]) },
			browserSettings: {},
			focusChainSettings: {},
			callbacks,
			coordinator: {},
		} as unknown as TaskConfig,
	}
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

	it("normalizes command rejection keys", () => {
		assert.equal(commandRejectionKey("  npm   run   build  "), "npm run build")
	})

	it("blocks a command after the user rejects it once", async () => {
		const handler = new ExecuteCommandToolHandler({} as never)
		const setup = config({ response: "noButtonClicked" })

		const rejected = await handler.execute(setup.config, block("npm run build"))
		assert.equal(rejected, "The user denied this operation.")
		assert.equal(setup.callbacks.executeCommandTool.called, false)
		assert.equal(setup.state.rejectedCommands.has(commandRejectionKey("npm run build")), true)

		setup.config.autoApprover.shouldAutoApproveTool = sinon.stub().returns([true, true])
		setup.callbacks.ask.resetHistory()

		const retry = await handler.execute(setup.config, block(" npm   run   build "))
		assert.match(String(retry), /already rejected this command/)
		assert.equal(setup.callbacks.ask.called, false)
		assert.equal(setup.callbacks.executeCommandTool.called, false)
		assert.equal(setup.state.didRejectTool, true)
	})

	it("scopes rejected commands by workspace hint", async () => {
		const handler = new ExecuteCommandToolHandler({} as never)
		const setup = config({ response: "noButtonClicked" })
		Object.assign(setup.config, {
			isMultiRootEnabled: true,
			workspaceManager: {
				getRootByName: (name: string) => ({ name, path: `/tmp/${name}` }),
				getRoots: () => [
					{ name: "backend", path: "/tmp/backend" },
					{ name: "frontend", path: "/tmp/frontend" },
				],
				getPrimaryRoot: () => ({ name: "backend", path: "/tmp/backend" }),
				resolvePathToRoot: () => undefined,
			},
		})

		const rejected = await handler.execute(setup.config, block("@backend:npm install"))
		assert.equal(rejected, "The user denied this operation.")
		assert.equal(setup.state.rejectedCommands.has(commandRejectionKey("@backend:npm install")), true)

		setup.config.autoApprover.shouldAutoApproveTool = sinon.stub().returns([true, true])
		const allowed = await handler.execute(setup.config, block("@frontend:npm install"))

		assert.equal(allowed, "executed")
		assert.equal(setup.callbacks.executeCommandTool.calledOnce, true)
		assert.equal(setup.callbacks.executeCommandTool.firstCall.args[0], 'cd "/tmp/frontend" && npm install')
	})
})
