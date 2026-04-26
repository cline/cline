import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ClineDefaultTool } from "@shared/tools"
import * as pathUtils from "@utils/path"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"
import { ToolValidator } from "../../ToolValidator"
import type { TaskConfig } from "../../types/TaskConfig"
import { ReadFileToolHandler } from "../ReadFileToolHandler"

/**
 * End-to-end tests for ReadFileToolHandler.execute().
 *
 * These exercise the actual handler with a mock TaskConfig (following the
 * SubagentToolHandler.test.ts pattern), verifying that:
 *
 *   1. Reading a non-existent file returns a tool error (not a thrown exception)
 *   2. consecutiveMistakeCount increments on failure
 *   3. Repeated failures accumulate (the counter is NOT reset before the read)
 *   4. A successful read resets consecutiveMistakeCount to 0
 *   5. Missing path parameter increments the counter
 */

let tmpDir: string

function createConfig() {
	const taskState = new TaskState()

	const callbacks = {
		say: sinon.stub().resolves(undefined),
		ask: sinon.stub().resolves({ response: "yesButtonClicked" }),
		saveCheckpoint: sinon.stub().resolves(),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
		shouldAutoApproveToolWithPath: sinon.stub().resolves(true),
		postStateToWebview: sinon.stub().resolves(),
		cancelTask: sinon.stub().resolves(),
		updateTaskHistory: sinon.stub().resolves([]),
		switchToActMode: sinon.stub().resolves(false),
		setActiveHookExecution: sinon.stub().resolves(),
		clearActiveHookExecution: sinon.stub().resolves(),
		getActiveHookExecution: sinon.stub().resolves(undefined),
		runUserPromptSubmitHook: sinon.stub().resolves({}),
		executeCommandTool: sinon.stub().resolves([false, "ok"]),
		cancelRunningCommandTool: sinon.stub().resolves(false),
		doesLatestTaskCompletionHaveNewChanges: sinon.stub().resolves(false),
		updateFCListFromToolResponse: sinon.stub().resolves(),
		shouldAutoApproveTool: sinon.stub().returns([true, true]),
		reinitExistingTaskFromId: sinon.stub().resolves(),
		applyLatestBrowserSettings: sinon.stub().resolves(undefined),
	}

	const config = {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: tmpDir,
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: true,
		doubleCheckCompletionEnabled: false,
		enableParallelToolCalling: true,
		isSubagentExecution: true, // skip UI calls and approval flow
		taskState,
		messageState: {},
		api: {
			getModel: () => ({ id: "test-model", info: { supportsImages: false } }),
		},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: { executeSafeCommands: false, executeAllCommands: false },
		},
		autoApprover: {
			shouldAutoApproveTool: sinon.stub().returns([true, true]),
		},
		browserSettings: {},
		focusChainSettings: {},
		services: {
			stateManager: {
				getGlobalStateKey: () => undefined,
				getGlobalSettingsKey: (key: string) => {
					if (key === "mode") return "act"
					if (key === "hooksEnabled") return false
					return undefined
				},
				getApiConfiguration: () => ({
					planModeApiProvider: "openai",
					actModeApiProvider: "openai",
				}),
			},
			fileContextTracker: {
				trackFileContext: sinon.stub().resolves(),
			},
			mcpHub: {},
			browserSession: {},
			urlContentFetcher: {},
			diffViewProvider: {},
			clineIgnoreController: { validateAccess: () => true },
			commandPermissionController: {},
			contextManager: {},
		},
		callbacks,
		coordinator: { getHandler: sinon.stub() },
	} as unknown as TaskConfig

	const validator = new ToolValidator({ validateAccess: () => true } as any)

	return { config, callbacks, taskState, validator }
}

function makeBlock(relPath?: string) {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.FILE_READ,
		params: relPath !== undefined ? { path: relPath } : {},
		partial: false,
	}
}

function makeBlockWithRange(relPath: string, startLine?: string, endLine?: string) {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.FILE_READ,
		params: {
			path: relPath,
			...(startLine !== undefined ? { start_line: startLine } : {}),
			...(endLine !== undefined ? { end_line: endLine } : {}),
		},
		partial: false,
	}
}

describe("ReadFileToolHandler.execute – file not found", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-read-test-"))
		sandbox.stub(pathUtils, "isLocatedInWorkspace").resolves(true)
	})

	afterEach(async () => {
		sandbox.restore()
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	})

	it("returns a tool error (not a thrown exception) for a non-existent file", async () => {
		const { config, taskState, validator } = createConfig()
		const handler = new ReadFileToolHandler(validator)

		const result = await handler.execute(config, makeBlock("no-such-file.py"))

		assert.equal(typeof result, "string")
		assert.ok((result as string).includes("File not found"))
		assert.equal(taskState.consecutiveMistakeCount, 1)
	})

	it("increments consecutiveMistakeCount on each failure without resetting", async () => {
		const { config, taskState, validator } = createConfig()
		const handler = new ReadFileToolHandler(validator)

		await handler.execute(config, makeBlock("ghost-1.py"))
		assert.equal(taskState.consecutiveMistakeCount, 1)

		await handler.execute(config, makeBlock("ghost-2.py"))
		assert.equal(taskState.consecutiveMistakeCount, 2)

		await handler.execute(config, makeBlock("ghost-3.py"))
		assert.equal(taskState.consecutiveMistakeCount, 3)
	})

	it("resets consecutiveMistakeCount to 0 after a successful read", async () => {
		const { config, taskState, validator } = createConfig()
		const handler = new ReadFileToolHandler(validator)

		// Accumulate two failures
		await handler.execute(config, makeBlock("ghost-1.py"))
		await handler.execute(config, makeBlock("ghost-2.py"))
		assert.equal(taskState.consecutiveMistakeCount, 2)

		// Create a real file and read it
		const realFile = "real-file.txt"
		await fs.writeFile(path.join(tmpDir, realFile), "hello world")

		const result = await handler.execute(config, makeBlock(realFile))
		assert.equal(result, "1 | hello world\n\n(File has 1 lines total.)")
		assert.equal(taskState.consecutiveMistakeCount, 0)
	})

	it("increments consecutiveMistakeCount when path parameter is missing", async () => {
		const { config, taskState, validator } = createConfig()
		const handler = new ReadFileToolHandler(validator)

		const result = await handler.execute(config, makeBlock())

		assert.equal(result, "missing")
		assert.equal(taskState.consecutiveMistakeCount, 1)
	})

	it("respects requested line ranges on cached rereads", async () => {
		const { config, validator } = createConfig()
		const handler = new ReadFileToolHandler(validator)

		const realFile = "real-file.txt"
		await fs.writeFile(path.join(tmpDir, realFile), "alpha\nbeta\ngamma\n")

		const firstRead = await handler.execute(config, makeBlock(realFile))
		assert.equal(firstRead, "1 | alpha\n2 | beta\n3 | gamma\n\n(File has 3 lines total.)")

		const secondRead = await handler.execute(config, makeBlockWithRange(realFile, "2", "2"))
		assert.equal(
			secondRead,
			"[File already read] The file 'real-file.txt' was already read earlier in this conversation. Returning content:\n2 | beta\n\n(Showing lines 2-2 of 3 total. Use start_line=3 to continue reading.)",
		)
	})
})
