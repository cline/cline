import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClineDefaultTool } from "@shared/tools";
import * as pathUtils from "@utils/path";
import { afterEach, beforeEach, describe, it } from "mocha";
import sinon from "sinon";
import type { ToolUse } from "../../../../assistant-message";
import { TaskState } from "../../../TaskState";
import { ToolValidator } from "../../ToolValidator";
import type { TaskConfig } from "../../types/TaskConfig";
import { createUIHelpers } from "../../types/UIHelpers";
import { WriteToFileToolHandler } from "../WriteToFileToolHandler";

/**
 * Regression tests for https://github.com/cline/cline/issues/12863:
 * replace_in_file intermittently targeted a directory or malformed path and failed with
 * "EISDIR: illegal operation on a directory, read".
 *
 * During streaming, the path param can be truncated mid-path (e.g. `tests` while the model
 * is still emitting `tests/JsonOutputTests.cpp`) or carry a partial closing tag
 * (e.g. `SortingTests.cpp<` / `CMakeLists.txt</path`). These tests verify that:
 *
 *   1. A path that resolves to a directory is skipped during streaming (no EISDIR)
 *   2. A directory path on the complete block fails once with a clear tool error
 *   3. replace_in_file never creates a file at a (possibly incomplete) path mid-stream
 *   4. handlePartialBlock strips partial closing tags from the path before opening
 */

let tmpDir: string;

function createDiffViewProviderStub() {
	const provider = {
		editType: undefined as undefined | "create" | "modify" | "delete",
		isEditing: false,
		originalContent: "" as string | undefined,
		openedPaths: [] as string[],
		open: undefined as any,
		update: sinon.stub().resolves(),
		revertChanges: sinon.stub().resolves(),
		reset: undefined as any,
		getOriginalContentForLLM: () => "",
	};
	provider.open = sinon.stub().callsFake(async (absolutePath: string) => {
		provider.isEditing = true;
		provider.openedPaths.push(absolutePath);
		provider.originalContent = await fs
			.readFile(absolutePath, "utf8")
			.catch(() => "");
	});
	provider.reset = sinon.stub().callsFake(async () => {
		provider.isEditing = false;
		provider.editType = undefined;
	});
	return provider;
}

function createConfig() {
	const taskState = new TaskState();
	const diffViewProvider = createDiffViewProviderStub();

	const callbacks = {
		say: sinon.stub().resolves(undefined),
		ask: sinon.stub().resolves({ response: "yesButtonClicked" }),
		saveCheckpoint: sinon.stub().resolves(),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
		shouldAutoApproveToolWithPath: sinon.stub().resolves(true),
	};

	const config = {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: tmpDir,
		mode: "act",
		enableParallelToolCalling: false,
		isMultiRootEnabled: false,
		taskState,
		messageState: { getClineMessages: () => [] },
		api: {
			getModel: () => ({ id: "test-model", info: { contextWindow: 128_000 } }),
		},
		autoApprovalSettings: { enableNotifications: false },
		autoApprover: { shouldAutoApproveTool: sinon.stub().returns(true) },
		services: {
			diffViewProvider,
			fileContextTracker: {
				trackFileContext: sinon.stub().resolves(),
				markFileAsEditedByCline: sinon.stub(),
			},
			stateManager: {
				getGlobalSettingsKey: () => "act",
				getApiConfiguration: () => ({
					planModeApiProvider: "openai",
					actModeApiProvider: "openai",
				}),
			},
		},
		callbacks,
		coordinator: undefined,
	} as unknown as TaskConfig;

	const validator = new ToolValidator({ validateAccess: () => true } as any);

	return { config, callbacks, taskState, validator, diffViewProvider };
}

function makeBlock(options: {
	name?: string;
	partial: boolean;
	path?: string;
	diff?: string;
	content?: string;
}): ToolUse {
	const params: Record<string, string> = {};
	if (options.path !== undefined) {
		params.path = options.path;
	}
	if (options.diff !== undefined) {
		params.diff = options.diff;
	}
	if (options.content !== undefined) {
		params.content = options.content;
	}
	return {
		type: "tool_use",
		name: (options.name ?? "replace_in_file") as ClineDefaultTool,
		params,
		partial: options.partial,
		call_id: "call-1",
	} as ToolUse;
}

const SIMPLE_DIFF =
	"------- SEARCH\nhello\n=======\ngoodbye\n+++++++ REPLACE\n";

describe("WriteToFileToolHandler path guards (issue #12863)", () => {
	let sandbox: sinon.SinonSandbox;

	beforeEach(async () => {
		sandbox = sinon.createSandbox();
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-write-guard-"));
		sandbox.stub(pathUtils, "isLocatedInWorkspace").resolves(true);
	});

	afterEach(async () => {
		sandbox.restore();
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	});

	describe("directory paths", () => {
		it("skips a directory path during streaming without opening or erroring", async () => {
			const { config, callbacks, taskState, validator, diffViewProvider } =
				createConfig();
			const handler = new WriteToFileToolHandler(validator);
			await fs.mkdir(path.join(tmpDir, "tests"));

			// Simulates a truncated streaming path: the model is still emitting
			// `tests/JsonOutputTests.cpp` but only `tests` has arrived so far.
			const block = makeBlock({
				partial: true,
				path: "tests",
				diff: SIMPLE_DIFF,
			});
			const result = await handler.validateAndPrepareFileOperation(
				config,
				block,
				"tests",
				SIMPLE_DIFF,
			);

			assert.equal(result, undefined);
			assert.equal(
				diffViewProvider.open.called,
				false,
				"must not open a directory",
			);
			assert.equal(
				diffViewProvider.editType,
				undefined,
				"must not lock in an edit type for a streaming path",
			);
			assert.equal(taskState.consecutiveMistakeCount, 0);
			assert.equal(callbacks.say.called, false);
		});

		it("fails once with a clear tool error when the complete block targets a directory", async () => {
			const { config, callbacks, taskState, validator, diffViewProvider } =
				createConfig();
			const handler = new WriteToFileToolHandler(validator);
			await fs.mkdir(path.join(tmpDir, "tests"));

			const block = makeBlock({
				partial: false,
				path: "tests",
				diff: SIMPLE_DIFF,
			});
			const result = await handler.execute(config, block);

			assert.equal(result, "");
			assert.equal(
				diffViewProvider.open.called,
				false,
				"must not open a directory",
			);
			assert.equal(taskState.consecutiveMistakeCount, 1);
			assert.ok(
				callbacks.say.calledWith("error"),
				"should surface a single clear error",
			);

			const toolResultText = JSON.stringify(
				config.taskState.userMessageContent,
			);
			assert.ok(
				toolResultText.includes("is a directory, not a file"),
				`unexpected tool result: ${toolResultText}`,
			);
		});

		it("write_to_file also rejects directory paths on the complete block", async () => {
			const { config, taskState, validator, diffViewProvider } = createConfig();
			const handler = new WriteToFileToolHandler(validator);
			await fs.mkdir(path.join(tmpDir, "src"));

			const block = makeBlock({
				name: "write_to_file",
				partial: false,
				path: "src",
				content: "hello",
			});
			const result = await handler.execute(config, block);

			assert.equal(result, "");
			assert.equal(diffViewProvider.open.called, false);
			assert.equal(taskState.consecutiveMistakeCount, 1);
		});
	});

	describe("replace_in_file on non-existent paths during streaming", () => {
		it("does not create a file at a possibly-incomplete path mid-stream", async () => {
			const { config, validator, diffViewProvider } = createConfig();
			const handler = new WriteToFileToolHandler(validator);

			// `src/output/JsonOut` is a truncated prefix of `src/output/JsonOutput.cpp`
			const truncated = "src/output/JsonOut";
			const block = makeBlock({
				partial: true,
				path: truncated,
				diff: SIMPLE_DIFF,
			});
			const result = await handler.validateAndPrepareFileOperation(
				config,
				block,
				truncated,
				SIMPLE_DIFF,
			);

			assert.equal(result, undefined);
			assert.equal(diffViewProvider.open.called, false);
			assert.equal(diffViewProvider.editType, undefined);
			const exists = await fs.access(path.join(tmpDir, truncated)).then(
				() => true,
				() => false,
			);
			assert.equal(
				exists,
				false,
				"must not create a junk file at the truncated path",
			);
		});

		it("still streams edits into an existing file", async () => {
			const { config, validator, diffViewProvider } = createConfig();
			const handler = new WriteToFileToolHandler(validator);
			await fs.writeFile(path.join(tmpDir, "file.cpp"), "hello\n");

			const block = makeBlock({
				partial: true,
				path: "file.cpp",
				diff: SIMPLE_DIFF,
			});
			await handler.validateAndPrepareFileOperation(
				config,
				block,
				"file.cpp",
				SIMPLE_DIFF,
			);

			assert.equal(diffViewProvider.open.calledOnce, true);
			assert.equal(
				diffViewProvider.openedPaths[0],
				path.join(tmpDir, "file.cpp"),
			);
			assert.equal(diffViewProvider.editType, "modify");
		});
	});

	describe("handlePartialBlock path sanitization", () => {
		it("strips a partial closing tag from the streamed path before opening", async () => {
			const { config, validator, diffViewProvider } = createConfig();
			const handler = new WriteToFileToolHandler(validator);
			await fs.writeFile(path.join(tmpDir, "SortingTests.cpp"), "hello\n");

			// The streaming XML parser can briefly expose `SortingTests.cpp</pat` as the path
			// value while the closing tag is still arriving.
			const block = makeBlock({
				partial: true,
				path: "SortingTests.cpp</pat",
				diff: SIMPLE_DIFF,
			});
			await handler.handlePartialBlock(block, createUIHelpers(config));

			assert.equal(diffViewProvider.open.calledOnce, true);
			assert.equal(
				diffViewProvider.openedPaths[0],
				path.join(tmpDir, "SortingTests.cpp"),
			);
		});

		it("strips a trailing '<' from the streamed path before opening", async () => {
			const { config, validator, diffViewProvider } = createConfig();
			const handler = new WriteToFileToolHandler(validator);
			await fs.writeFile(path.join(tmpDir, "SortingTests.cpp"), "hello\n");

			const block = makeBlock({
				partial: true,
				path: "SortingTests.cpp<",
				diff: SIMPLE_DIFF,
			});
			await handler.handlePartialBlock(block, createUIHelpers(config));

			assert.equal(diffViewProvider.open.calledOnce, true);
			assert.equal(
				diffViewProvider.openedPaths[0],
				path.join(tmpDir, "SortingTests.cpp"),
			);
		});
	});
});
