import { describe, it, expect, vi, beforeEach } from "vitest"
import { handleCheckpointRestoreOperation } from "../checkpointRestoreHandler"
import { saveTaskMessages } from "../../task-persistence"
import pWaitFor from "p-wait-for"
import * as vscode from "vscode"

// Mock dependencies
vi.mock("../../task-persistence", () => ({
	saveTaskMessages: vi.fn(),
}))
vi.mock("p-wait-for")
vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
	},
}))

describe("checkpointRestoreHandler", () => {
	let mockProvider: any
	let mockCline: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock Cline instance
		mockCline = {
			taskId: "test-task-123",
			abort: false,
			abortTask: vi.fn(() => {
				mockCline.abort = true
			}),
			checkpointRestore: vi.fn(),
			clineMessages: [
				{ ts: 1, type: "user", say: "user", text: "First message" },
				{ ts: 2, type: "assistant", say: "assistant", text: "Response" },
				{
					ts: 3,
					type: "user",
					say: "user",
					text: "Checkpoint message",
					checkpoint: { hash: "abc123" },
				},
				{ ts: 4, type: "assistant", say: "assistant", text: "After checkpoint" },
			],
		}

		// Setup mock provider
		mockProvider = {
			getCurrentTask: vi.fn(() => mockCline),
			postMessageToWebview: vi.fn(),
			getTaskWithId: vi.fn(() => ({
				historyItem: { id: "test-task-123", messages: mockCline.clineMessages },
			})),
			createTaskWithHistoryItem: vi.fn(),
			setPendingEditOperation: vi.fn(),
			contextProxy: {
				globalStorageUri: { fsPath: "/test/storage" },
			},
		}

		// Mock pWaitFor to resolve immediately
		;(pWaitFor as any).mockImplementation(async (condition: () => boolean) => {
			// Simulate the condition being met
			return Promise.resolve()
		})
	})

	describe("handleCheckpointRestoreOperation", () => {
		it("should abort task before checkpoint restore for delete operations", async () => {
			// Simulate a task that hasn't been aborted yet
			mockCline.abort = false

			await handleCheckpointRestoreOperation({
				provider: mockProvider,
				currentCline: mockCline,
				messageTs: 3,
				messageIndex: 2,
				checkpoint: { hash: "abc123" },
				operation: "delete",
			})

			// Verify abortTask was called before checkpointRestore
			expect(mockCline.abortTask).toHaveBeenCalled()
			expect(mockCline.checkpointRestore).toHaveBeenCalled()

			// Verify the order of operations
			const abortOrder = mockCline.abortTask.mock.invocationCallOrder[0]
			const restoreOrder = mockCline.checkpointRestore.mock.invocationCallOrder[0]
			expect(abortOrder).toBeLessThan(restoreOrder)
		})

		it("should not abort task if already aborted", async () => {
			// Simulate a task that's already aborted
			mockCline.abort = true

			await handleCheckpointRestoreOperation({
				provider: mockProvider,
				currentCline: mockCline,
				messageTs: 3,
				messageIndex: 2,
				checkpoint: { hash: "abc123" },
				operation: "delete",
			})

			// Verify abortTask was not called
			expect(mockCline.abortTask).not.toHaveBeenCalled()
			expect(mockCline.checkpointRestore).toHaveBeenCalled()
		})

		it("should handle edit operations with pending edit data", async () => {
			const editData = {
				editedContent: "Edited content",
				images: ["image1.png"],
				apiConversationHistoryIndex: 2,
			}

			await handleCheckpointRestoreOperation({
				provider: mockProvider,
				currentCline: mockCline,
				messageTs: 3,
				messageIndex: 2,
				checkpoint: { hash: "abc123" },
				operation: "edit",
				editData,
			})

			// Verify abortTask was NOT called for edit operations
			expect(mockCline.abortTask).not.toHaveBeenCalled()

			// Verify pending edit operation was set
			expect(mockProvider.setPendingEditOperation).toHaveBeenCalledWith("task-test-task-123", {
				messageTs: 3,
				editedContent: "Edited content",
				images: ["image1.png"],
				messageIndex: 2,
				apiConversationHistoryIndex: 2,
			})

			// Verify checkpoint restore was called with edit operation
			expect(mockCline.checkpointRestore).toHaveBeenCalledWith({
				ts: 3,
				commitHash: "abc123",
				mode: "restore",
				operation: "edit",
			})
		})

		it("should save messages after delete operation", async () => {
			// Mock the checkpoint restore to simulate message deletion
			mockCline.checkpointRestore.mockImplementation(async () => {
				mockCline.clineMessages = mockCline.clineMessages.slice(0, 2)
			})

			await handleCheckpointRestoreOperation({
				provider: mockProvider,
				currentCline: mockCline,
				messageTs: 3,
				messageIndex: 2,
				checkpoint: { hash: "abc123" },
				operation: "delete",
			})

			// Verify saveTaskMessages was called
			expect(saveTaskMessages).toHaveBeenCalledWith({
				messages: mockCline.clineMessages,
				taskId: "test-task-123",
				globalStoragePath: "/test/storage",
			})

			// Verify createTaskWithHistoryItem was called
			expect(mockProvider.createTaskWithHistoryItem).toHaveBeenCalled()
		})

		it("should reinitialize task with correct history item after delete", async () => {
			const expectedHistoryItem = {
				id: "test-task-123",
				messages: mockCline.clineMessages,
			}

			await handleCheckpointRestoreOperation({
				provider: mockProvider,
				currentCline: mockCline,
				messageTs: 3,
				messageIndex: 2,
				checkpoint: { hash: "abc123" },
				operation: "delete",
			})

			// Verify getTaskWithId was called
			expect(mockProvider.getTaskWithId).toHaveBeenCalledWith("test-task-123")

			// Verify createTaskWithHistoryItem was called with the correct history item
			expect(mockProvider.createTaskWithHistoryItem).toHaveBeenCalledWith(expectedHistoryItem)
		})

		it("should not save messages or reinitialize for edit operation", async () => {
			const editData = {
				editedContent: "Edited content",
				images: [],
				apiConversationHistoryIndex: 2,
			}

			await handleCheckpointRestoreOperation({
				provider: mockProvider,
				currentCline: mockCline,
				messageTs: 3,
				messageIndex: 2,
				checkpoint: { hash: "abc123" },
				operation: "edit",
				editData,
			})

			// Verify saveTaskMessages was NOT called for edit operation
			expect(saveTaskMessages).not.toHaveBeenCalled()

			// Verify createTaskWithHistoryItem was NOT called for edit operation
			expect(mockProvider.createTaskWithHistoryItem).not.toHaveBeenCalled()
		})

		it("should handle errors gracefully", async () => {
			// Mock checkpoint restore to throw an error
			mockCline.checkpointRestore.mockRejectedValue(new Error("Checkpoint restore failed"))

			// The function should throw and show an error message
			await expect(
				handleCheckpointRestoreOperation({
					provider: mockProvider,
					currentCline: mockCline,
					messageTs: 3,
					messageIndex: 2,
					checkpoint: { hash: "abc123" },
					operation: "delete",
				}),
			).rejects.toThrow("Checkpoint restore failed")

			// Verify error message was shown
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Error during checkpoint restore: Checkpoint restore failed",
			)
		})
	})
})
