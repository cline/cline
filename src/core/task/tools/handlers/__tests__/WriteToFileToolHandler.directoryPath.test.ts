import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { ClineDefaultTool } from "@shared/tools"
import { TaskState } from "../../../TaskState"
import { ToolValidator } from "../../ToolValidator"
import type { TaskConfig } from "../../types/TaskConfig"
import { ToolResultUtils } from "../../utils/ToolResultUtils"
import { WriteToFileToolHandler } from "../WriteToFileToolHandler"

const EXPECTED_DIRECTORY_ERROR =
	"The provided path is a directory, not a file. Please specify the exact file within this directory that you wish to edit."

let tmpDir: string

function createConfig() {
	const taskState = new TaskState()

	const callbacks = {
		say: sinon.stub().resolves(undefined),
		ask: sinon.stub().resolves({ response: "yesButtonClicked" }),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
		shouldAutoApproveToolWithPath: sinon.stub().resolves(true),
	}

	const config = {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: tmpDir,
		mode: "act",
		isMultiRootEnabled: false,
		enableParallelToolCalling: true,
		taskState,
		messageState: {} as TaskConfig["messageState"],
		api: {
			getModel: () => ({ id: "test-model", info: {} }),
		},
		autoApprovalSettings: { enableNotifications: false, actions: {} },
		autoApprover: { shouldAutoApproveTool: sinon.stub().returns([true, true]) },
		browserSettings: {},
		focusChainSettings: {},
		callbacks,
		coordinator: { getHandler: sinon.stub().returns(null) },
		services: {
			diffViewProvider: {
				editType: undefined as "create" | "modify" | undefined,
				isEditing: false,
				reset: sinon.stub().resolves(undefined),
				open: sinon.stub().rejects(new Error("diffViewProvider.open should not run for a directory path")),
				update: sinon.stub().resolves(undefined),
				revertChanges: sinon.stub().resolves(undefined),
				originalContent: "",
				getOriginalContentForLLM: sinon.stub().returns(""),
			},
			stateManager: {
				getGlobalSettingsKey: sinon.stub().returns("act"),
				getApiConfiguration: sinon.stub().returns({ planModeApiProvider: "x", actModeApiProvider: "x" }),
			},
			fileContextTracker: { trackFileContext: sinon.stub().resolves() },
			mcpHub: {},
			browserSession: {},
			urlContentFetcher: {},
			clineIgnoreController: { validateAccess: () => true },
			commandPermissionController: {},
			contextManager: {},
		},
	} as unknown as TaskConfig

	const validator = new ToolValidator({ validateAccess: () => true } as any)

	return { config, callbacks, taskState, validator }
}

function makeReplaceInFileBlock(relPath: string, partial = false): ToolUse {
	return {
		type: "tool_use",
		name: ClineDefaultTool.FILE_EDIT,
		params: {
			path: relPath,
			diff: "------- SEARCH\nnope\n=======\nstill no\n+++++++ REPLACE\n",
		},
		partial,
	}
}

function makeWriteToFileBlock(relPath: string): ToolUse {
	return {
		type: "tool_use",
		name: ClineDefaultTool.FILE_NEW,
		params: {
			path: relPath,
			content: "// new file body",
		},
		partial: false,
	}
}

describe("WriteToFileToolHandler.validateAndPrepareFileOperation – directory path", () => {
	let sandbox: sinon.SinonSandbox
	let pushToolResultStub: sinon.SinonStub

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		pushToolResultStub = sandbox.stub(ToolResultUtils, "pushToolResult")
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-w2f-dir-test-"))
	})

	afterEach(async () => {
		sandbox.restore()
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	})

	it("returns early with a tool error when replace_in_file targets a directory (no open/read)", async () => {
		const subDir = path.join(tmpDir, "only_a_directory")
		await fs.mkdir(subDir, { recursive: true })

		const { config, callbacks, taskState, validator } = createConfig()
		const handler = new WriteToFileToolHandler(validator)
		const block = makeReplaceInFileBlock("only_a_directory")

		const result = await handler.validateAndPrepareFileOperation(
			config,
			block,
			"only_a_directory",
			block.params.diff as string,
			undefined,
		)

		assert.equal(result, undefined)
		assert.equal(taskState.consecutiveMistakeCount, 1)
		assert.ok(
			(callbacks.say as sinon.SinonStub).calledWith("error", EXPECTED_DIRECTORY_ERROR),
			"expected say('error', directory message)",
		)
		assert.ok((config.services.diffViewProvider.reset as sinon.SinonStub).calledOnce)
		assert.ok(pushToolResultStub.calledOnce, "tool result should be pushed for the LLM")
		const pushed = pushToolResultStub.firstCall.args[0] as string
		assert.ok(pushed.includes(EXPECTED_DIRECTORY_ERROR), `expected tool result to include directory hint, got: ${pushed}`)
		assert.ok(
			(config.services.diffViewProvider.open as sinon.SinonStub).notCalled,
			"must not read/open a directory as a file",
		)
	})

	it("sets didAlreadyUseTool when parallel tool calling is disabled", async () => {
		const subDir = path.join(tmpDir, "dir2")
		await fs.mkdir(subDir, { recursive: true })

		const { config, taskState, validator } = createConfig()
		config.enableParallelToolCalling = false
		taskState.didAlreadyUseTool = false

		const handler = new WriteToFileToolHandler(validator)
		const block = makeReplaceInFileBlock("dir2")

		await handler.validateAndPrepareFileOperation(config, block, "dir2", block.params.diff as string, undefined)

		assert.equal(taskState.didAlreadyUseTool, true)
	})

	it("does not push errors on partial blocks when path is a directory (streaming)", async () => {
		const subDir = path.join(tmpDir, "partial_dir")
		await fs.mkdir(subDir, { recursive: true })

		const { config, callbacks, taskState, validator } = createConfig()
		const handler = new WriteToFileToolHandler(validator)
		const block = makeReplaceInFileBlock("partial_dir", true)

		const result = await handler.validateAndPrepareFileOperation(
			config,
			block,
			"partial_dir",
			block.params.diff as string,
			undefined,
		)

		assert.equal(result, undefined)
		assert.equal(taskState.consecutiveMistakeCount, 0)
		assert.ok(pushToolResultStub.notCalled)
		assert.ok((callbacks.say as sinon.SinonStub).notCalled)
		assert.ok((config.services.diffViewProvider.reset as sinon.SinonStub).notCalled)
	})

	it("returns early with a tool error when write_to_file targets a directory", async () => {
		const subDir = path.join(tmpDir, "write_to_dir")
		await fs.mkdir(subDir, { recursive: true })

		const { config, callbacks, taskState, validator } = createConfig()
		const handler = new WriteToFileToolHandler(validator)
		const block = makeWriteToFileBlock("write_to_dir")

		const result = await handler.validateAndPrepareFileOperation(
			config,
			block,
			"write_to_dir",
			undefined,
			block.params.content as string,
		)

		assert.equal(result, undefined)
		assert.equal(taskState.consecutiveMistakeCount, 1)
		assert.ok(
			(callbacks.say as sinon.SinonStub).calledWith("error", EXPECTED_DIRECTORY_ERROR),
			"expected say('error', directory message)",
		)
		assert.ok(pushToolResultStub.calledOnce)
		const pushed = pushToolResultStub.firstCall.args[0] as string
		assert.ok(pushed.includes(EXPECTED_DIRECTORY_ERROR))
		assert.ok((config.services.diffViewProvider.open as sinon.SinonStub).notCalled)
	})
})
