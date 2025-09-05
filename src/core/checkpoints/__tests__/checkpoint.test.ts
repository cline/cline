import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Task } from "../../task/Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { checkpointSave, checkpointRestore, checkpointDiff, getCheckpointService } from "../index"
import * as vscode from "vscode"

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({})),
		showInformationMessage: vi.fn(),
	},
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
		parse: vi.fn((uri: string) => ({ with: vi.fn(() => ({})) })),
	},
	commands: {
		executeCommand: vi.fn(),
	},
}))

// Mock other dependencies
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureCheckpointCreated: vi.fn(),
			captureCheckpointRestored: vi.fn(),
			captureCheckpointDiffed: vi.fn(),
		},
	},
}))

vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn(() => "/test/workspace"),
}))

vi.mock("../../../services/checkpoints")

describe("Checkpoint functionality", () => {
	let mockProvider: any
	let mockTask: any
	let mockCheckpointService: any

	beforeEach(async () => {
		// Create mock checkpoint service
		mockCheckpointService = {
			isInitialized: true,
			saveCheckpoint: vi.fn().mockResolvedValue({ commit: "test-commit-hash" }),
			restoreCheckpoint: vi.fn().mockResolvedValue(undefined),
			getDiff: vi.fn().mockResolvedValue([]),
			on: vi.fn(),
			initShadowGit: vi.fn().mockResolvedValue(undefined),
		}

		// Create mock provider
		mockProvider = {
			context: {
				globalStorageUri: { fsPath: "/test/storage" },
			},
			log: vi.fn(),
			postMessageToWebview: vi.fn(),
			postStateToWebview: vi.fn(),
			cancelTask: vi.fn(),
		}

		// Create mock task
		mockTask = {
			taskId: "test-task-id",
			enableCheckpoints: true,
			checkpointService: mockCheckpointService,
			checkpointServiceInitializing: false,
			providerRef: {
				deref: () => mockProvider,
			},
			clineMessages: [],
			apiConversationHistory: [],
			pendingUserMessageCheckpoint: undefined,
			say: vi.fn().mockResolvedValue(undefined),
			overwriteClineMessages: vi.fn(),
			overwriteApiConversationHistory: vi.fn(),
			combineMessages: vi.fn().mockReturnValue([]),
		}

		// Update the mock to return our mockCheckpointService
		const checkpointsModule = await import("../../../services/checkpoints")
		vi.mocked(checkpointsModule.RepoPerTaskCheckpointService.create).mockReturnValue(mockCheckpointService)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("checkpointSave", () => {
		it("should wait for checkpoint service initialization before saving", async () => {
			// Set up task with uninitialized service
			mockCheckpointService.isInitialized = false
			mockTask.checkpointService = mockCheckpointService

			// Simulate service initialization after a delay
			setTimeout(() => {
				mockCheckpointService.isInitialized = true
			}, 100)

			// Call checkpointSave
			const savePromise = checkpointSave(mockTask, true)

			// Wait for the save to complete
			const result = await savePromise

			// saveCheckpoint should have been called
			expect(mockCheckpointService.saveCheckpoint).toHaveBeenCalledWith(
				expect.stringContaining("Task: test-task-id"),
				{ allowEmpty: true, suppressMessage: false },
			)

			// Result should contain the commit hash
			expect(result).toEqual({ commit: "test-commit-hash" })

			// Task should still have checkpoints enabled
			expect(mockTask.enableCheckpoints).toBe(true)
		})

		it("should handle timeout when service doesn't initialize", async () => {
			// Service never initializes
			mockCheckpointService.isInitialized = false

			// Call checkpointSave with a task that has no checkpoint service
			const taskWithNoService = {
				...mockTask,
				checkpointService: undefined,
				enableCheckpoints: false,
			}

			const result = await checkpointSave(taskWithNoService, true)

			// Result should be undefined
			expect(result).toBeUndefined()

			// saveCheckpoint should not have been called
			expect(mockCheckpointService.saveCheckpoint).not.toHaveBeenCalled()
		})

		it("should preserve checkpoint data through message deletion flow", async () => {
			// Initialize service
			mockCheckpointService.isInitialized = true
			mockTask.checkpointService = mockCheckpointService

			// Simulate saving checkpoint before user message
			const checkpointResult = await checkpointSave(mockTask, true)
			expect(checkpointResult).toEqual({ commit: "test-commit-hash" })

			// Simulate setting pendingUserMessageCheckpoint
			if (checkpointResult && "commit" in checkpointResult) {
				mockTask.pendingUserMessageCheckpoint = {
					hash: checkpointResult.commit,
					timestamp: Date.now(),
					type: "user_message",
				}
			}

			// Verify checkpoint data is preserved
			expect(mockTask.pendingUserMessageCheckpoint).toBeDefined()
			expect(mockTask.pendingUserMessageCheckpoint.hash).toBe("test-commit-hash")

			// Simulate message deletion and reinitialization
			mockTask.clineMessages = []
			mockTask.checkpointService = mockCheckpointService // Keep service available
			mockTask.checkpointServiceInitializing = false

			// Save checkpoint again after deletion
			const newCheckpointResult = await checkpointSave(mockTask, true)

			// Should still work after reinitialization
			expect(newCheckpointResult).toEqual({ commit: "test-commit-hash" })
			expect(mockTask.enableCheckpoints).toBe(true)
		})

		it("should handle errors gracefully and disable checkpoints", async () => {
			mockCheckpointService.saveCheckpoint.mockRejectedValue(new Error("Save failed"))

			const result = await checkpointSave(mockTask)

			expect(result).toBeUndefined()
			expect(mockTask.enableCheckpoints).toBe(false)
		})
	})

	describe("checkpointRestore", () => {
		beforeEach(() => {
			mockTask.clineMessages = [
				{ ts: 1, say: "user", text: "Message 1" },
				{ ts: 2, say: "assistant", text: "Message 2" },
				{ ts: 3, say: "user", text: "Message 3" },
			]
			mockTask.apiConversationHistory = [
				{ ts: 1, role: "user", content: [{ type: "text", text: "Message 1" }] },
				{ ts: 2, role: "assistant", content: [{ type: "text", text: "Message 2" }] },
				{ ts: 3, role: "user", content: [{ type: "text", text: "Message 3" }] },
			]
		})

		it("should restore checkpoint for delete operation", async () => {
			await checkpointRestore(mockTask, {
				ts: 2,
				commitHash: "abc123",
				mode: "restore",
				operation: "delete",
			})

			expect(mockCheckpointService.restoreCheckpoint).toHaveBeenCalledWith("abc123")
			expect(mockTask.overwriteApiConversationHistory).toHaveBeenCalledWith([
				{ ts: 1, role: "user", content: [{ type: "text", text: "Message 1" }] },
			])
			expect(mockTask.overwriteClineMessages).toHaveBeenCalledWith([{ ts: 1, say: "user", text: "Message 1" }])
			expect(mockProvider.cancelTask).toHaveBeenCalled()
		})

		it("should restore checkpoint for edit operation", async () => {
			await checkpointRestore(mockTask, {
				ts: 2,
				commitHash: "abc123",
				mode: "restore",
				operation: "edit",
			})

			expect(mockCheckpointService.restoreCheckpoint).toHaveBeenCalledWith("abc123")
			expect(mockTask.overwriteApiConversationHistory).toHaveBeenCalledWith([
				{ ts: 1, role: "user", content: [{ type: "text", text: "Message 1" }] },
			])
			// For edit operation, should include the message being edited
			expect(mockTask.overwriteClineMessages).toHaveBeenCalledWith([
				{ ts: 1, say: "user", text: "Message 1" },
				{ ts: 2, say: "assistant", text: "Message 2" },
			])
			expect(mockProvider.cancelTask).toHaveBeenCalled()
		})

		it("should handle preview mode without modifying messages", async () => {
			await checkpointRestore(mockTask, {
				ts: 2,
				commitHash: "abc123",
				mode: "preview",
			})

			expect(mockCheckpointService.restoreCheckpoint).toHaveBeenCalledWith("abc123")
			expect(mockTask.overwriteApiConversationHistory).not.toHaveBeenCalled()
			expect(mockTask.overwriteClineMessages).not.toHaveBeenCalled()
			expect(mockProvider.cancelTask).toHaveBeenCalled()
		})

		it("should handle missing message gracefully", async () => {
			await checkpointRestore(mockTask, {
				ts: 999, // Non-existent timestamp
				commitHash: "abc123",
				mode: "restore",
			})

			expect(mockCheckpointService.restoreCheckpoint).not.toHaveBeenCalled()
		})

		it("should disable checkpoints on error", async () => {
			mockCheckpointService.restoreCheckpoint.mockRejectedValue(new Error("Restore failed"))

			await checkpointRestore(mockTask, {
				ts: 2,
				commitHash: "abc123",
				mode: "restore",
			})

			expect(mockTask.enableCheckpoints).toBe(false)
			expect(mockProvider.log).toHaveBeenCalledWith("[checkpointRestore] disabling checkpoints for this task")
		})
	})

	describe("checkpointDiff", () => {
		beforeEach(() => {
			mockTask.clineMessages = [
				{ ts: 1, say: "user", text: "Message 1" },
				{ ts: 2, say: "checkpoint_saved", text: "commit1" },
				{ ts: 3, say: "user", text: "Message 2" },
				{ ts: 4, say: "checkpoint_saved", text: "commit2" },
			]
		})

		it("should show diff for full mode", async () => {
			const mockChanges = [
				{
					paths: { absolute: "/test/file.ts", relative: "file.ts" },
					content: { before: "old content", after: "new content" },
				},
			]
			mockCheckpointService.getDiff.mockResolvedValue(mockChanges)

			await checkpointDiff(mockTask, {
				ts: 4,
				commitHash: "commit2",
				mode: "full",
			})

			expect(mockCheckpointService.getDiff).toHaveBeenCalledWith({
				from: "commit2",
				to: undefined,
			})
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"vscode.changes",
				"Changes since task started",
				expect.any(Array),
			)
		})

		it("should show diff for checkpoint mode with next commit", async () => {
			const mockChanges = [
				{
					paths: { absolute: "/test/file.ts", relative: "file.ts" },
					content: { before: "old content", after: "new content" },
				},
			]
			mockCheckpointService.getDiff.mockResolvedValue(mockChanges)
			await checkpointDiff(mockTask, {
				ts: 4,
				commitHash: "commit1",
				mode: "checkpoint",
			})

			expect(mockCheckpointService.getDiff).toHaveBeenCalledWith({
				from: "commit1",
				to: "commit2",
			})
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"vscode.changes",
				"Changes compare with next checkpoint",
				expect.any(Array),
			)
		})

		it("should find next checkpoint automatically in checkpoint mode", async () => {
			const mockChanges = [
				{
					paths: { absolute: "/test/file.ts", relative: "file.ts" },
					content: { before: "old content", after: "new content" },
				},
			]
			mockCheckpointService.getDiff.mockResolvedValue(mockChanges)

			await checkpointDiff(mockTask, {
				ts: 4,
				commitHash: "commit1",
				mode: "checkpoint",
			})

			expect(mockCheckpointService.getDiff).toHaveBeenCalledWith({
				from: "commit1", // Should find the next checkpoint
				to: "commit2",
			})
		})

		it("should show information message when no changes found", async () => {
			mockCheckpointService.getDiff.mockResolvedValue([])

			await checkpointDiff(mockTask, {
				ts: 4,
				commitHash: "commit2",
				mode: "full",
			})

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("No changes found.")
			expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
		})

		it("should disable checkpoints on error", async () => {
			mockCheckpointService.getDiff.mockRejectedValue(new Error("Diff failed"))

			await checkpointDiff(mockTask, {
				ts: 4,
				commitHash: "commit2",
				mode: "full",
			})

			expect(mockTask.enableCheckpoints).toBe(false)
			expect(mockProvider.log).toHaveBeenCalledWith("[checkpointDiff] disabling checkpoints for this task")
		})
	})

	describe("getCheckpointService", () => {
		it("should return existing service if available", async () => {
			const service = await getCheckpointService(mockTask)
			expect(service).toBe(mockCheckpointService)
		})

		it("should return undefined if checkpoints are disabled", async () => {
			mockTask.enableCheckpoints = false
			const service = await getCheckpointService(mockTask)
			expect(service).toBeUndefined()
		})

		it("should return undefined if service is still initializing", async () => {
			mockTask.checkpointService = undefined
			mockTask.checkpointServiceInitializing = true
			const service = await getCheckpointService(mockTask)
			expect(service).toBeUndefined()
		})

		it("should create new service if none exists", async () => {
			mockTask.checkpointService = undefined
			mockTask.checkpointServiceInitializing = false

			const service = getCheckpointService(mockTask)

			const checkpointsModule = await import("../../../services/checkpoints")
			expect(vi.mocked(checkpointsModule.RepoPerTaskCheckpointService.create)).toHaveBeenCalledWith({
				taskId: "test-task-id",
				workspaceDir: "/test/workspace",
				shadowDir: "/test/storage",
				log: expect.any(Function),
			})
		})

		it("should disable checkpoints if workspace path is not found", async () => {
			const pathModule = await import("../../../utils/path")
			vi.mocked(pathModule.getWorkspacePath).mockReturnValue(null as any)

			mockTask.checkpointService = undefined
			mockTask.checkpointServiceInitializing = false

			const service = await getCheckpointService(mockTask)

			expect(service).toBeUndefined()
			expect(mockTask.enableCheckpoints).toBe(false)
		})
	})
})
