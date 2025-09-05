import { describe, it, expect, vi, beforeEach } from "vitest"
import { webviewMessageHandler } from "../webviewMessageHandler"
import { saveTaskMessages } from "../../task-persistence"
import { handleCheckpointRestoreOperation } from "../checkpointRestoreHandler"

// Mock dependencies
vi.mock("../../task-persistence")
vi.mock("../checkpointRestoreHandler")
vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
	},
	workspace: {
		workspaceFolders: undefined,
	},
}))

describe("webviewMessageHandler - checkpoint operations", () => {
	let mockProvider: any
	let mockCline: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock Cline instance
		mockCline = {
			taskId: "test-task-123",
			clineMessages: [
				{ ts: 1, type: "user", say: "user", text: "First message" },
				{ ts: 2, type: "assistant", say: "checkpoint_saved", text: "abc123" },
				{ ts: 3, type: "user", say: "user", text: "Message to delete" },
				{ ts: 4, type: "assistant", say: "assistant", text: "After message" },
			],
			apiConversationHistory: [
				{ ts: 1, role: "user", content: [{ type: "text", text: "First message" }] },
				{ ts: 3, role: "user", content: [{ type: "text", text: "Message to delete" }] },
				{ ts: 4, role: "assistant", content: [{ type: "text", text: "After message" }] },
			],
			checkpointRestore: vi.fn(),
			overwriteClineMessages: vi.fn(),
			overwriteApiConversationHistory: vi.fn(),
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
	})

	describe("delete operations with checkpoint restoration", () => {
		it("should call handleCheckpointRestoreOperation for checkpoint deletes", async () => {
			// Mock handleCheckpointRestoreOperation
			;(handleCheckpointRestoreOperation as any).mockResolvedValue(undefined)

			// Call the handler with delete confirmation
			await webviewMessageHandler(mockProvider, {
				type: "deleteMessageConfirm",
				messageTs: 1,
				restoreCheckpoint: true,
			})

			// Verify handleCheckpointRestoreOperation was called with correct parameters
			expect(handleCheckpointRestoreOperation).toHaveBeenCalledWith({
				provider: mockProvider,
				currentCline: mockCline,
				messageTs: 1,
				messageIndex: 0,
				checkpoint: { hash: "abc123" },
				operation: "delete",
			})
		})

		it("should save messages for non-checkpoint deletes", async () => {
			// Call the handler with delete confirmation (no checkpoint restoration)
			await webviewMessageHandler(mockProvider, {
				type: "deleteMessageConfirm",
				messageTs: 2,
				restoreCheckpoint: false,
			})

			// Verify saveTaskMessages was called
			expect(saveTaskMessages).toHaveBeenCalledWith({
				messages: expect.any(Array),
				taskId: "test-task-123",
				globalStoragePath: "/test/storage",
			})

			// Verify checkpoint restore was NOT called
			expect(mockCline.checkpointRestore).not.toHaveBeenCalled()
		})
	})

	describe("edit operations with checkpoint restoration", () => {
		it("should call handleCheckpointRestoreOperation for checkpoint edits", async () => {
			// Mock handleCheckpointRestoreOperation
			;(handleCheckpointRestoreOperation as any).mockResolvedValue(undefined)

			// Call the handler with edit confirmation
			await webviewMessageHandler(mockProvider, {
				type: "editMessageConfirm",
				messageTs: 1,
				text: "Edited checkpoint message",
				restoreCheckpoint: true,
			})

			// Verify handleCheckpointRestoreOperation was called with correct parameters
			expect(handleCheckpointRestoreOperation).toHaveBeenCalledWith({
				provider: mockProvider,
				currentCline: mockCline,
				messageTs: 1,
				messageIndex: 0,
				checkpoint: { hash: "abc123" },
				operation: "edit",
				editData: {
					editedContent: "Edited checkpoint message",
					images: undefined,
					apiConversationHistoryIndex: 0,
				},
			})
		})
	})
})
