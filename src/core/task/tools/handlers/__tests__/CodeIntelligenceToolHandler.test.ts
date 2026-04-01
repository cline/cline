import { strict as assert } from "node:assert"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { ClineDefaultTool } from "@/shared/tools"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { CodeIntelligenceToolHandler } from "../CodeIntelligenceToolHandler"

/**
 * Tests for CodeIntelligenceToolHandler.
 *
 * Verifies:
 *   1. Missing queries parameter increments mistake count and returns error
 *   2. When PSI client is unavailable, returns a graceful fallback error
 *   3. When PSI client is available and queries are valid, calls the client correctly
 *   4. Handles unknown operations gracefully
 */

function createConfig(overrides: Partial<TaskConfig> = {}) {
	const taskState = new TaskState()

	const callbacks = {
		say: sinon.stub().resolves(undefined),
		ask: sinon.stub().resolves({ response: "yesButtonClicked" }),
		saveCheckpoint: sinon.stub().resolves(),
		sayAndCreateMissingParamError: sinon.stub().resolves("Missing required parameter: queries"),
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
		taskId: "task-ci-1",
		ulid: "ulid-ci-1",
		cwd: "/test/project",
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		doubleCheckCompletionEnabled: false,
		vscodeTerminalExecutionMode: "backgroundExec",
		enableParallelToolCalling: false,
		isSubagentExecution: false,
		taskState,
		messageState: {},
		api: {
			getModel: () => ({ id: "test-model", info: { supportsImages: false } }),
		},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: {},
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
					return undefined
				},
				getApiConfiguration: () => ({
					planModeApiProvider: "openai",
					actModeApiProvider: "openai",
				}),
			},
			fileContextTracker: { trackFileContext: sinon.stub().resolves() },
			mcpHub: {},
			browserSession: {},
			urlContentFetcher: {},
			diffViewProvider: {},
		},
		callbacks,
		providerInfo: { providerId: "openai", model: { id: "test-model", info: { supportsImages: false } } },
		...overrides,
	} as unknown as TaskConfig

	return { config, taskState, callbacks }
}

function makeBlock(queries?: string) {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.CODE_INTELLIGENCE,
		id: "tool-1",
		params: { queries },
		partial: false,
	}
}

describe("CodeIntelligenceToolHandler", () => {
	let handler: CodeIntelligenceToolHandler
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		handler = new CodeIntelligenceToolHandler()
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("missing queries parameter", () => {
		it("should increment mistake count and return error", async () => {
			// Stub psi so we don't need HostProvider initialized for this test
			sandbox.stub(HostProvider, "psi" as any).get(() => undefined)
			const { config, taskState } = createConfig()
			assert.equal(taskState.consecutiveMistakeCount, 0)

			const result = await handler.execute(config, makeBlock(undefined))

			assert.equal(taskState.consecutiveMistakeCount, 1)
			assert.equal(result, "Missing required parameter: queries")
		})
	})

	describe("PSI client unavailable", () => {
		it("should return a fallback error when HostProvider.psi is undefined", async () => {
			sandbox.stub(HostProvider, "psi" as any).get(() => undefined)
			const { config } = createConfig()

			const result = await handler.execute(config, makeBlock("definition | myFunction"))

			assert.ok(typeof result === "string")
			assert.ok(result.includes("not available"), `Expected fallback error but got: ${result}`)
		})
	})

	describe("PSI client available", () => {
		it("should call searchSymbols for search operations", async () => {
			const mockPsi = {
				searchSymbols: sinon.stub().resolves({
					groups: [
						{
							results: [
								{
									symbolName: "MyClass",
									kind: "class",
									filePath: "/test/project/src/MyClass.ts",
									line: 10,
									containerName: "",
									containerFilePath: "",
									containerLine: 0,
									lineContent: "export class MyClass {",
								},
							],
						},
					],
				}),
			}
			sandbox.stub(HostProvider, "psi" as any).get(() => mockPsi)

			const { config } = createConfig()
			const result = await handler.execute(config, makeBlock("search | MyClass"))

			assert.ok(typeof result === "string")
			assert.ok(mockPsi.searchSymbols.calledOnce, "searchSymbols should have been called")
			assert.ok(result.includes("MyClass"), `Expected result to contain MyClass but got: ${result}`)
		})

		it("should call getDefinition for definition operations", async () => {
			const mockPsi = {
				getDefinition: sinon.stub().resolves({
					groups: [
						{
							definition: {
								symbolName: "myFunction",
								kind: "function",
								filePath: "/test/project/src/utils.ts",
								line: 42,
								lineContent: "export function myFunction() {",
								containerName: "",
								containerFilePath: "",
								containerLine: 0,
							},
							results: [],
						},
					],
				}),
			}
			sandbox.stub(HostProvider, "psi" as any).get(() => mockPsi)

			const { config } = createConfig()
			const result = await handler.execute(config, makeBlock("definition | src/utils.ts | myFunction"))

			assert.ok(typeof result === "string")
			assert.ok(mockPsi.getDefinition.calledOnce, "getDefinition should have been called")
			assert.ok(result.includes("myFunction"), `Expected result to contain myFunction but got: ${result}`)
		})

		it("should handle unknown operations gracefully", async () => {
			const mockPsi = {}
			sandbox.stub(HostProvider, "psi" as any).get(() => mockPsi)

			const { config } = createConfig()
			const result = await handler.execute(config, makeBlock("invalid_op | mySymbol"))

			assert.ok(typeof result === "string")
			assert.ok(result.includes("Unknown operation"), `Expected unknown op error but got: ${result}`)
		})

		it("should return error and increment mistake count for empty queries (only whitespace/comments)", async () => {
			const mockPsi = {}
			sandbox.stub(HostProvider, "psi" as any).get(() => mockPsi)

			const { config, taskState, callbacks } = createConfig()
			assert.equal(taskState.consecutiveMistakeCount, 0)

			const result = await handler.execute(config, makeBlock("# just a comment\n\n"))

			assert.ok(typeof result === "string")
			assert.ok(result.includes("No valid queries"), `Expected no valid queries error but got: ${result}`)
			assert.equal(taskState.consecutiveMistakeCount, 1, "Should increment mistake count for empty queries")
			assert.ok(!callbacks.say.called, "Should not call say() for invalid queries")
		})

		it("should handle multiple queries in a single call", async () => {
			const mockPsi = {
				getDefinition: sinon.stub().resolves({
					groups: [
						{
							definition: {
								symbolName: "foo",
								kind: "function",
								filePath: "/test/project/src/a.ts",
								line: 1,
								lineContent: "function foo() {}",
								containerName: "",
								containerFilePath: "",
								containerLine: 0,
							},
							results: [],
						},
					],
				}),
				getReferences: sinon.stub().resolves({
					groups: [
						{
							definition: {
								symbolName: "bar",
								kind: "function",
								filePath: "/test/project/src/b.ts",
								line: 5,
								lineContent: "function bar() {}",
								containerName: "",
								containerFilePath: "",
								containerLine: 0,
							},
							results: [
								{
									symbolName: "bar",
									kind: "reference",
									filePath: "/test/project/src/c.ts",
									line: 10,
									lineContent: "bar()",
									containerName: "main",
									containerFilePath: "/test/project/src/c.ts",
									containerLine: 1,
								},
							],
						},
					],
				}),
			}
			sandbox.stub(HostProvider, "psi" as any).get(() => mockPsi)

			const { config } = createConfig()
			const queries = "definition | src/a.ts | foo\nreferences | src/b.ts | bar"
			const result = await handler.execute(config, makeBlock(queries))

			assert.ok(typeof result === "string")
			assert.ok(mockPsi.getDefinition.calledOnce)
			assert.ok(mockPsi.getReferences.calledOnce)
			assert.ok(result.includes("foo"))
			assert.ok(result.includes("bar"))
		})
	})

	describe("getDescription", () => {
		it("should show the first query line", () => {
			const block = makeBlock("definition | src/main.ts | MyClass")
			const desc = handler.getDescription(block)
			assert.ok(desc.includes("definition | src/main.ts | MyClass"))
		})

		it("should show ... for empty queries", () => {
			const block = makeBlock("")
			const desc = handler.getDescription(block)
			assert.ok(desc.includes("..."))
		})
	})
})
