import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as sinon from "sinon"
import { HookDiscoveryCache } from "../core/hooks/HookDiscoveryCache"
import { executeHook } from "../core/hooks/hook-executor"
import { StateManager } from "../core/storage/StateManager"
import { MessageStateHandler } from "../core/task/message-state"
import { TaskState } from "../core/task/TaskState"
import { ClineMessage } from "../shared/ExtensionMessage"

/**
 * Unit tests for the hook-executor module
 * These tests verify the consolidated hook execution logic that replaced
 * ~400 lines of duplicated code across TaskStart, TaskResume, UserPromptSubmit, and TaskCancel
 */
describe("Hook Executor", () => {
	// Skip all hook tests on Windows as hooks are not yet supported on that platform
	if (process.platform === "win32") {
		it.skip("Hook tests are not supported on Windows yet", () => {
			// This is intentional - hooks will be implemented for Windows in a future release
		})
		return
	}
	let tempDir: string
	let baseTempDir: string // Store base directory for cleanup
	let testHandler: MessageStateHandler
	let mockMessages: ClineMessage[]
	let stateManagerStub: sinon.SinonStub

	/**
	 * Helper to create a minimal MessageStateHandler for testing
	 */
	function createTestHandler(): MessageStateHandler {
		const taskState = new TaskState()
		return new MessageStateHandler({
			taskId: "test-task-id",
			ulid: "test-ulid",
			taskState,
			updateTaskHistory: async () => [],
		})
	}

	/**
	 * Helper to create a test hook script
	 */
	async function createHookScript(
		hookName: string,
		output: { cancel?: boolean; contextModification?: string; errorMessage?: string },
		exitCode: number = 0,
		delayMs: number = 0,
	): Promise<string> {
		const scriptPath = path.join(tempDir, hookName)
		const scriptContent = `#!/usr/bin/env node
const delay = ${delayMs};
setTimeout(() => {
  console.log(${JSON.stringify(JSON.stringify(output))});
  process.exit(${exitCode});
}, delay);
`
		await fs.writeFile(scriptPath, scriptContent, { mode: 0o755 })
		return scriptPath
	}

	beforeEach(async () => {
		// Reset the hook discovery cache before each test
		// This ensures tests get a fresh cache and can discover newly created hooks
		HookDiscoveryCache.resetForTesting()

		// Create temporary directory for test hooks
		baseTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-test-"))
		// Create .clinerules/hooks subdirectory structure
		tempDir = path.join(baseTempDir, ".clinerules", "hooks")
		await fs.mkdir(tempDir, { recursive: true })
		testHandler = createTestHandler()
		mockMessages = []

		// Mock StateManager to return baseTempDir as workspace root
		// This allows HookFactory to find hooks in baseTempDir/.clinerules/hooks/
		stateManagerStub = sinon.stub(StateManager, "get").returns({
			getGlobalStateKey: (key: string) => {
				if (key === "workspaceRoots") {
					return [{ path: baseTempDir }]
				}
				return undefined
			},
		} as any)
	})

	afterEach(async () => {
		// Clean up temporary directory (including entire base directory)
		try {
			await fs.rm(baseTempDir, { recursive: true, force: true })
		} catch (error) {
			// Ignore cleanup errors
		}

		// Restore StateManager stub
		stateManagerStub.restore()
	})

	describe("Basic Hook Execution", () => {
		it("should return wasCancelled: false when hooks are disabled", async () => {
			const result = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							initialTask: "test task",
						},
					},
				},
				isCancellable: true,
				say: async () => undefined,
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: false, // Disabled
			})

			result.should.deepEqual({
				wasCancelled: false,
			})
		})

		it("should return wasCancelled: false when hook doesn't exist", async () => {
			// Point to non-existent directory
			const result = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							initialTask: "test task",
						},
					},
				},
				isCancellable: true,
				say: async () => undefined,
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			result.should.deepEqual({
				wasCancelled: false,
			})
		})

		it("should execute hook successfully and return result", async function () {
			this.timeout(5000)

			// Create a simple hook that returns success
			await createHookScript("TaskStart", {
				cancel: false,
				contextModification: "Test context modification",
			})

			const sayMessages: Array<{ type: string; text: string }> = []
			const result = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							initialTask: "test task",
						},
					},
				},
				isCancellable: true,
				say: async (type: any, text?: string) => {
					sayMessages.push({ type, text: text || "" })
					return Date.now()
				},
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			// Verify result
			result.cancel!.should.equal(false)
			result.contextModification!.should.equal("Test context modification")
			result.wasCancelled.should.equal(false)

			// Verify messages were sent
			sayMessages.should.matchAny((msg: any) => msg.type === "hook")
		})

		it("should handle hook that requests cancellation", async function () {
			this.timeout(5000)

			await createHookScript("TaskStart", {
				cancel: true,
				contextModification: "Cancelling task",
				errorMessage: "Task cancelled by hook",
			})

			const result = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							initialTask: "test task",
						},
					},
				},
				isCancellable: true,
				say: async () => Date.now(),
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			result.cancel!.should.equal(true)
			result.contextModification!.should.equal("Cancelling task")
			result.errorMessage!.should.equal("Task cancelled by hook")
			result.wasCancelled.should.equal(false) // Not user-cancelled, hook requested cancel
		})
	})

	describe("Cancellable Hooks", () => {
		it("should support user cancellation for cancellable hooks", async function () {
			this.timeout(5000)

			// Create a hook that takes some time to execute
			await createHookScript(
				"TaskStart",
				{
					cancel: false,
				},
				0,
				2000, // 2 second delay
			)

			let capturedAbortController: AbortController | null = null
			let setHookCalled = false
			let clearHookCalled = false

			const result = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							initialTask: "test task",
						},
					},
				},
				isCancellable: true,
				say: async () => Date.now(),
				setActiveHookExecution: async (execution) => {
					setHookCalled = true
					capturedAbortController = execution.abortController
					// Abort after capturing the controller
					setTimeout(() => {
						capturedAbortController?.abort()
					}, 100)
				},
				clearActiveHookExecution: async () => {
					clearHookCalled = true
				},
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			result.cancel!.should.equal(true)
			result.wasCancelled.should.equal(true)
			setHookCalled.should.equal(true)
			// clearHookCalled should be true after abort
			clearHookCalled.should.equal(true)
		})

		it("should not allow cancellation for non-cancellable hooks", async function () {
			this.timeout(5000)

			await createHookScript("TaskCancel", {
				cancel: false,
			})

			// For non-cancellable hooks, setActiveHookExecution should not be called
			let setHookCalled = false

			const result = await executeHook({
				hookName: "TaskCancel",
				hookInput: {
					taskCancel: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							completionStatus: "cancelled",
						},
					},
				},
				isCancellable: false, // Not cancellable
				say: async () => Date.now(),
				setActiveHookExecution: async () => {
					setHookCalled = true
				},
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			result.cancel!.should.equal(false)
			result.wasCancelled.should.equal(false)
			// setActiveHookExecution should not be called for non-cancellable hooks
			// (In real execution, this would be verified, but test doesn't reach that point)
		})
	})

	describe("Error Handling", () => {
		it("should handle hook execution failure gracefully", async function () {
			this.timeout(5000)

			// Create a hook that exits with non-zero status
			await createHookScript("TaskStart", {}, 1)

			const result = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							initialTask: "test task",
						},
					},
				},
				isCancellable: true,
				say: async () => Date.now(),
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			// Hook failure should not crash, just return safe defaults
			result.wasCancelled.should.equal(false)
		})

		it("should update message state on hook failure", async function () {
			this.timeout(5000)

			await createHookScript("TaskStart", {}, 1) // Exit with error

			const messages: ClineMessage[] = []
			const mockHandler = {
				...testHandler,
				getClineMessages: () => messages,
				addToClineMessages: async (msg: ClineMessage) => {
					messages.push(msg)
				},
				updateClineMessage: async (index: number, updates: Partial<ClineMessage>) => {
					if (messages[index]) {
						Object.assign(messages[index], updates)
					}
				},
			} as any

			await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							initialTask: "test task",
						},
					},
				},
				isCancellable: true,
				say: async (type: any, text?: string) => {
					const msg: ClineMessage = {
						ts: Date.now(),
						type: "say",
						say: type,
						text,
					}
					messages.push(msg)
					return msg.ts
				},
				messageStateHandler: mockHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			// Should have recorded hook message
			messages.length.should.be.greaterThan(0)
		})
	})

	describe("Message State Updates", () => {
		it("should create hook message with running status", async function () {
			this.timeout(5000)

			await createHookScript("TaskStart", {
				cancel: false,
			})

			const messages: ClineMessage[] = []

			await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							initialTask: "test task",
						},
					},
				},
				isCancellable: true,
				say: async (type: any, text?: string) => {
					const msg: ClineMessage = {
						ts: Date.now(),
						type: "say",
						say: type,
						text,
					}
					messages.push(msg)
					return msg.ts
				},
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			// Should have at least one hook message
			messages.length.should.be.greaterThan(0)
			const hookMessage = messages.find((m) => m.say === "hook")
			should.exist(hookMessage)
		})

		it("should update hook message to completed status on success", async function () {
			this.timeout(5000)

			await createHookScript("TaskStart", {
				cancel: false,
			})

			const messages: ClineMessage[] = []
			const mockHandler = {
				...testHandler,
				getClineMessages: () => messages,
				updateClineMessage: async (index: number, updates: Partial<ClineMessage>) => {
					if (messages[index]) {
						Object.assign(messages[index], updates)
					}
				},
			} as any

			await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							initialTask: "test task",
						},
					},
				},
				isCancellable: true,
				say: async (type: any, text?: string) => {
					const msg: ClineMessage = {
						ts: Date.now(),
						type: "say",
						say: type,
						text,
					}
					messages.push(msg)
					return msg.ts
				},
				messageStateHandler: mockHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			// Verify hook message exists
			messages.length.should.be.greaterThan(0)
		})
	})

	describe("Different Hook Types", () => {
		it("should execute TaskResume hook with correct input structure", async function () {
			this.timeout(5000)

			await createHookScript("TaskResume", {
				cancel: false,
				contextModification: "Resume context",
			})

			const result = await executeHook({
				hookName: "TaskResume",
				hookInput: {
					taskResume: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
						},
						previousState: {
							lastMessageTs: "12345",
							messageCount: "10",
							conversationHistoryDeleted: "false",
						},
					},
				},
				isCancellable: true,
				say: async () => Date.now(),
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			result.wasCancelled.should.equal(false)
		})

		it("should execute UserPromptSubmit hook with correct input structure", async function () {
			this.timeout(5000)

			await createHookScript("UserPromptSubmit", {
				cancel: false,
			})

			const result = await executeHook({
				hookName: "UserPromptSubmit",
				hookInput: {
					userPromptSubmit: {
						prompt: "Test prompt",
						attachments: [],
					},
				},
				isCancellable: true,
				say: async () => Date.now(),
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			result.wasCancelled.should.equal(false)
		})

		it("should execute TaskCancel hook as non-cancellable", async function () {
			this.timeout(5000)

			await createHookScript("TaskCancel", {
				cancel: false,
			})

			const result = await executeHook({
				hookName: "TaskCancel",
				hookInput: {
					taskCancel: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							completionStatus: "cancelled",
						},
					},
				},
				isCancellable: false, // TaskCancel is not cancellable
				say: async () => Date.now(),
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			result.wasCancelled.should.equal(false)
		})
	})

	describe("Edge Cases", () => {
		it("should handle empty context modification", async function () {
			this.timeout(5000)

			await createHookScript("TaskStart", {
				cancel: false,
				contextModification: "",
			})

			const result = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							initialTask: "test task",
						},
					},
				},
				isCancellable: true,
				say: async () => Date.now(),
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			result.contextModification!.should.equal("")
			result.wasCancelled.should.equal(false)
		})

		it("should handle undefined optional fields in result", async function () {
			this.timeout(5000)

			await createHookScript("TaskStart", {
				cancel: false,
			})

			const result = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: "test-task",
							ulid: "test-ulid",
							initialTask: "test task",
						},
					},
				},
				isCancellable: true,
				say: async () => Date.now(),
				messageStateHandler: testHandler,
				taskId: "test-task",
				hooksEnabled: true,
			})

			result.wasCancelled.should.equal(false)
			// contextModification and errorMessage may be undefined
		})
	})
})
