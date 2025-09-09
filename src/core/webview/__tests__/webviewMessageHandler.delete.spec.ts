import { describe, it, expect, beforeEach, vi } from "vitest"
import { webviewMessageHandler } from "../webviewMessageHandler"
import * as vscode from "vscode"
import { ClineProvider } from "../ClineProvider"

// Mock the saveTaskMessages function
vi.mock("../../task-persistence", () => ({
	saveTaskMessages: vi.fn(),
}))

// Mock the i18n module
vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
	changeLanguage: vi.fn(),
}))

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
	workspace: {
		workspaceFolders: undefined,
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
			update: vi.fn(),
		})),
	},
	ConfigurationTarget: {
		Global: 1,
		Workspace: 2,
		WorkspaceFolder: 3,
	},
	Uri: {
		parse: vi.fn((str) => ({ toString: () => str })),
		file: vi.fn((path) => ({ fsPath: path })),
	},
	env: {
		openExternal: vi.fn(),
		clipboard: {
			writeText: vi.fn(),
		},
	},
	commands: {
		executeCommand: vi.fn(),
	},
}))

describe("webviewMessageHandler delete functionality", () => {
	let provider: any
	let getCurrentTaskMock: any

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Create mock task
		getCurrentTaskMock = {
			clineMessages: [],
			apiConversationHistory: [],
			overwriteClineMessages: vi.fn(async () => {}),
			overwriteApiConversationHistory: vi.fn(async () => {}),
			taskId: "test-task-id",
		}

		// Create mock provider
		provider = {
			getCurrentTask: vi.fn(() => getCurrentTaskMock),
			postMessageToWebview: vi.fn(),
			contextProxy: {
				getValue: vi.fn(),
				setValue: vi.fn(async () => {}),
				globalStorageUri: { fsPath: "/test/path" },
			},
			log: vi.fn(),
			cwd: "/test/cwd",
		}
	})

	describe("handleDeleteMessageConfirm", () => {
		it("should handle deletion when apiConversationHistoryIndex is -1 (message not in API history)", async () => {
			// Setup test data with a user message and assistant response
			const userMessageTs = 1000
			const assistantMessageTs = 1001

			getCurrentTaskMock.clineMessages = [
				{ ts: userMessageTs, say: "user", text: "Hello" },
				{ ts: assistantMessageTs, say: "assistant", text: "Hi there" },
			]

			// API history has the assistant message but not the user message
			// This simulates the case where the user message wasn't in API history
			getCurrentTaskMock.apiConversationHistory = [
				{ ts: assistantMessageTs, role: "assistant", content: { type: "text", text: "Hi there" } },
				{
					ts: 1002,
					role: "assistant",
					content: { type: "text", text: "attempt_completion" },
					name: "attempt_completion",
				},
			]

			// Call delete for the user message
			await webviewMessageHandler(provider, {
				type: "deleteMessageConfirm",
				messageTs: userMessageTs,
			})

			// Verify that clineMessages was truncated at the correct index
			expect(getCurrentTaskMock.overwriteClineMessages).toHaveBeenCalledWith([])

			// When message is not found in API history (index is -1),
			// API history should be truncated from the first API message at/after the deleted timestamp (fallback)
			expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalledWith([])
		})

		it("should handle deletion when exact apiConversationHistoryIndex is found", async () => {
			// Setup test data where message exists in both arrays
			const messageTs = 1000

			getCurrentTaskMock.clineMessages = [
				{ ts: 900, say: "user", text: "Previous message" },
				{ ts: messageTs, say: "user", text: "Delete this" },
				{ ts: 1100, say: "assistant", text: "Response" },
			]

			getCurrentTaskMock.apiConversationHistory = [
				{ ts: 900, role: "user", content: { type: "text", text: "Previous message" } },
				{ ts: messageTs, role: "user", content: { type: "text", text: "Delete this" } },
				{ ts: 1100, role: "assistant", content: { type: "text", text: "Response" } },
			]

			// Call delete
			await webviewMessageHandler(provider, {
				type: "deleteMessageConfirm",
				messageTs: messageTs,
			})

			// Verify truncation at correct indices
			expect(getCurrentTaskMock.overwriteClineMessages).toHaveBeenCalledWith([
				{ ts: 900, say: "user", text: "Previous message" },
			])

			expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalledWith([
				{ ts: 900, role: "user", content: { type: "text", text: "Previous message" } },
			])
		})

		it("should handle deletion when message not found in clineMessages", async () => {
			getCurrentTaskMock.clineMessages = [{ ts: 1000, say: "user", text: "Some message" }]

			getCurrentTaskMock.apiConversationHistory = []

			// Call delete with non-existent timestamp
			await webviewMessageHandler(provider, {
				type: "deleteMessageConfirm",
				messageTs: 9999,
			})

			// Verify error message was shown (expecting translation key since t() is mocked to return the key)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.message.message_not_found")

			// Verify no truncation occurred
			expect(getCurrentTaskMock.overwriteClineMessages).not.toHaveBeenCalled()
			expect(getCurrentTaskMock.overwriteApiConversationHistory).not.toHaveBeenCalled()
		})

		it("should handle deletion with attempt_completion in API history", async () => {
			// Setup test data with attempt_completion
			const userMessageTs = 1000
			const attemptCompletionTs = 1001

			getCurrentTaskMock.clineMessages = [
				{ ts: userMessageTs, say: "user", text: "Fix the bug" },
				{ ts: attemptCompletionTs, say: "assistant", text: "I've fixed the bug" },
			]

			// API history has attempt_completion but user message is missing
			getCurrentTaskMock.apiConversationHistory = [
				{
					ts: attemptCompletionTs,
					role: "assistant",
					content: {
						type: "text",
						text: "I've fixed the bug in the code",
					},
					name: "attempt_completion",
				},
				{
					ts: 1002,
					role: "user",
					content: { type: "text", text: "Looks good, but..." },
				},
			]

			// Call delete for the user message
			await webviewMessageHandler(provider, {
				type: "deleteMessageConfirm",
				messageTs: userMessageTs,
			})

			// Verify that clineMessages was truncated
			expect(getCurrentTaskMock.overwriteClineMessages).toHaveBeenCalledWith([])

			// API history should be truncated from first message at/after deleted timestamp (fallback)
			expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalledWith([])
		})

		it("should preserve messages before the deleted one", async () => {
			const messageTs = 2000

			getCurrentTaskMock.clineMessages = [
				{ ts: 1000, say: "user", text: "First message" },
				{ ts: 1500, say: "assistant", text: "First response" },
				{ ts: messageTs, say: "user", text: "Delete this" },
				{ ts: 2500, say: "assistant", text: "Response to delete" },
			]

			getCurrentTaskMock.apiConversationHistory = [
				{ ts: 1000, role: "user", content: { type: "text", text: "First message" } },
				{ ts: 1500, role: "assistant", content: { type: "text", text: "First response" } },
				{ ts: messageTs, role: "user", content: { type: "text", text: "Delete this" } },
				{ ts: 2500, role: "assistant", content: { type: "text", text: "Response to delete" } },
			]

			await webviewMessageHandler(provider, {
				type: "deleteMessageConfirm",
				messageTs: messageTs,
			})

			// Should preserve messages before the deleted one
			expect(getCurrentTaskMock.overwriteClineMessages).toHaveBeenCalledWith([
				{ ts: 1000, say: "user", text: "First message" },
				{ ts: 1500, say: "assistant", text: "First response" },
			])

			// API history should be truncated at the exact index
			expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalledWith([
				{ ts: 1000, role: "user", content: { type: "text", text: "First message" } },
				{ ts: 1500, role: "assistant", content: { type: "text", text: "First response" } },
			])
		})
	})
})
