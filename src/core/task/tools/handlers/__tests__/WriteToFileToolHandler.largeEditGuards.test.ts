import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"
import { ToolValidator } from "../../ToolValidator"
import type { TaskConfig } from "../../types/TaskConfig"
import { MAX_FILE_EDIT_CONTENT_BYTES } from "../../utils/LargeEditGuards"
import { WriteToFileToolHandler } from "../WriteToFileToolHandler"

function createConfig(tmpDir: string) {
	const taskState = new TaskState()
	const diffViewProvider = {
		isEditing: false,
		editType: undefined,
		originalContent: "",
		open: sinon.stub().resolves(),
		update: sinon.stub().resolves(),
		saveChanges: sinon.stub().resolves({}),
		revertChanges: sinon.stub().resolves(),
		reset: sinon.stub().resolves(),
		scrollToFirstDiff: sinon.stub().resolves(),
		getOriginalContentForLLM: sinon.stub().callsFake(() => diffViewProvider.originalContent),
	}

	const callbacks = {
		say: sinon.stub().resolves(undefined),
		ask: sinon.stub().resolves({ response: "yesButtonClicked" }),
		saveCheckpoint: sinon.stub().resolves(),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
		executeCommandTool: sinon.stub().resolves([false, "ok"]),
		cancelRunningCommandTool: sinon.stub().resolves(false),
		doesLatestTaskCompletionHaveNewChanges: sinon.stub().resolves(false),
		updateFCListFromToolResponse: sinon.stub().resolves(),
		shouldAutoApproveTool: sinon.stub().returns([true, true]),
		shouldAutoApproveToolWithPath: sinon.stub().resolves(true),
		postStateToWebview: sinon.stub().resolves(),
		reinitExistingTaskFromId: sinon.stub().resolves(),
		cancelTask: sinon.stub().resolves(),
		updateTaskHistory: sinon.stub().resolves([]),
		applyLatestBrowserSettings: sinon.stub().resolves({}),
		switchToActMode: sinon.stub().resolves(false),
		setActiveHookExecution: sinon.stub().resolves(),
		clearActiveHookExecution: sinon.stub().resolves(),
		getActiveHookExecution: sinon.stub().resolves(undefined),
		runUserPromptSubmitHook: sinon.stub().resolves({}),
	}

	const config = {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: tmpDir,
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: true,
		doubleCheckCompletionEnabled: false,
		vscodeTerminalExecutionMode: "backgroundExec",
		enableParallelToolCalling: true,
		isSubagentExecution: true,
		taskState,
		messageState: {} as any,
		api: {
			getModel: () => ({ id: "test-model", info: { supportsImages: false, contextWindow: 128_000 } }),
		},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: { executeSafeCommands: false, executeAllCommands: false },
		},
		autoApprover: {
			shouldAutoApproveTool: sinon.stub().returns([true, true]),
		},
		browserSettings: {} as any,
		focusChainSettings: {} as any,
		services: {
			stateManager: {
				getGlobalStateKey: () => undefined,
				getGlobalSettingsKey: (key: string) => {
					if (key === "mode") return "act"
					if (key === "hooksEnabled") return false
					return undefined
				},
				getApiConfiguration: () => ({ planModeApiProvider: "openai", actModeApiProvider: "openai" }),
			},
			fileContextTracker: {
				trackFileContext: sinon.stub().resolves(),
				markFileAsEditedByCline: sinon.stub(),
			},
			mcpHub: {} as any,
			browserSession: {} as any,
			urlContentFetcher: {} as any,
			diffViewProvider,
			clineIgnoreController: { validateAccess: () => true, filterPaths: (paths: string[]) => paths },
			commandPermissionController: {} as any,
			contextManager: {} as any,
		},
		callbacks,
		coordinator: { getHandler: sinon.stub() },
	} as unknown as TaskConfig

	return { config, callbacks, taskState, diffViewProvider }
}

describe("WriteToFileToolHandler large edit guards", () => {
	let sandbox: sinon.SinonSandbox
	let tmpDir: string

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		tmpDir = path.join(os.tmpdir(), `cline-write-large-${Date.now()}`)
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("returns a tool error and avoids opening the diff view for oversized write_to_file payloads", async () => {
		const { config, taskState, diffViewProvider } = createConfig(tmpDir)
		const handler = new WriteToFileToolHandler(new ToolValidator({ validateAccess: () => true } as any))
		const oversized = "x".repeat(MAX_FILE_EDIT_CONTENT_BYTES + 1)

		const result = await handler.execute(config, {
			type: "tool_use",
			name: "write_to_file",
			params: {
				path: "big.ts",
				content: oversized,
			},
			partial: false,
		} as any)

		assert.equal(result, "")
		assert.equal(taskState.consecutiveMistakeCount, 1)
		assert.equal(taskState.didAlreadyUseTool, false)
		assert.equal(taskState.userMessageContent.length, 1)
		const oversizedWriteMessage = taskState.userMessageContent[0] as any
		assert.match(oversizedWriteMessage.text, /edit payload is too large/)
		sinon.assert.notCalled(diffViewProvider.open)
		sinon.assert.notCalled(diffViewProvider.update)
		sinon.assert.notCalled(diffViewProvider.saveChanges)
		sinon.assert.notCalled(diffViewProvider.revertChanges)
	})

	it("summarizes huge original file content when replace_in_file diff construction fails", async () => {
		const { config, taskState, diffViewProvider } = createConfig(tmpDir)
		const handler = new WriteToFileToolHandler(new ToolValidator({ validateAccess: () => true } as any))
		const relPath = "big.ts"
		const absolutePath = path.join(tmpDir, relPath)
		const hugeOriginal = "x".repeat(70 * 1024)

		await fs.mkdir(tmpDir, { recursive: true })
		await fs.writeFile(absolutePath, hugeOriginal, "utf8")
		diffViewProvider.originalContent = hugeOriginal

		const result = await handler.execute(config, {
			type: "tool_use",
			name: "replace_in_file",
			params: {
				path: relPath,
				diff: "<<<<<<< SEARCH\nnot-present\n=======\nreplacement\n>>>>>>> REPLACE",
			},
			partial: false,
		} as any)

		assert.equal(result, "")
		assert.equal(taskState.consecutiveMistakeCount, 1)
		assert.equal(taskState.userMessageContent.length, 1)
		const diffFailureMessage = taskState.userMessageContent[0] as any
		assert.match(diffFailureMessage.text, /omitted from tool payload/)
		assert.doesNotMatch(diffFailureMessage.text, /<file_content path="big\.ts">/)
		sinon.assert.calledOnce(diffViewProvider.open)
		sinon.assert.calledOnce(diffViewProvider.reset)
		sinon.assert.notCalled(diffViewProvider.saveChanges)
	})
})
