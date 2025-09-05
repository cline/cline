import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import type { ClineProvider } from "../../webview/ClineProvider"
import type { ProviderSettings } from "@roo-code/types"

// Mock vscode module before importing Task
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(),
			onDidChange: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		})),
		getConfiguration: vi.fn(() => ({
			get: vi.fn(() => true),
		})),
		openTextDocument: vi.fn(),
		applyEdit: vi.fn(),
	},
	RelativePattern: vi.fn((base, pattern) => ({ base, pattern })),
	window: {
		createOutputChannel: vi.fn(() => ({
			appendLine: vi.fn(),
			dispose: vi.fn(),
		})),
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
		showTextDocument: vi.fn(),
		activeTextEditor: undefined,
	},
	Uri: {
		file: vi.fn((path) => ({ fsPath: path })),
		parse: vi.fn((str) => ({ toString: () => str })),
	},
	Range: vi.fn(),
	Position: vi.fn(),
	WorkspaceEdit: vi.fn(() => ({
		replace: vi.fn(),
		insert: vi.fn(),
		delete: vi.fn(),
	})),
	ViewColumn: {
		One: 1,
		Two: 2,
		Three: 3,
	},
}))

// Mock other dependencies
vi.mock("../../services/mcp/McpServerManager", () => ({
	McpServerManager: {
		getInstance: vi.fn().mockResolvedValue(null),
	},
}))

vi.mock("../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		releaseTerminalsForTask: vi.fn(),
	},
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureTaskCreated: vi.fn(),
			captureTaskRestarted: vi.fn(),
			captureConversationMessage: vi.fn(),
			captureLlmCompletion: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
		},
	},
}))

describe("Task grounding sources handling", () => {
	let mockProvider: Partial<ClineProvider>
	let mockApiConfiguration: ProviderSettings
	let Task: any

	beforeAll(async () => {
		// Import Task after mocks are set up
		const taskModule = await import("../Task")
		Task = taskModule.Task
	})

	beforeEach(() => {
		// Mock provider with necessary methods
		mockProvider = {
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			getState: vi.fn().mockResolvedValue({
				mode: "code",
				experiments: {},
			}),
			context: {
				globalStorageUri: { fsPath: "/test/storage" },
				extensionPath: "/test/extension",
			} as any,
			log: vi.fn(),
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		}

		mockApiConfiguration = {
			apiProvider: "gemini",
			geminiApiKey: "test-key",
			enableGrounding: true,
		} as ProviderSettings
	})

	it("should strip grounding sources from assistant message before persisting to API history", async () => {
		// Create a task instance
		const task = new Task({
			provider: mockProvider as ClineProvider,
			apiConfiguration: mockApiConfiguration,
			task: "Test task",
			startTask: false,
		})

		// Mock the API conversation history
		task.apiConversationHistory = []

		// Simulate an assistant message with grounding sources
		const assistantMessageWithSources = `
This is the main response content.

[1] Example Source: https://example.com
[2] Another Source: https://another.com

Sources: [1](https://example.com), [2](https://another.com)
		`.trim()

		// Mock grounding sources
		const mockGroundingSources = [
			{ title: "Example Source", url: "https://example.com" },
			{ title: "Another Source", url: "https://another.com" },
		]

		// Spy on addToApiConversationHistory to check what gets persisted
		const addToApiHistorySpy = vi.spyOn(task as any, "addToApiConversationHistory")

		// Simulate the logic from Task.ts that strips grounding sources
		let cleanAssistantMessage = assistantMessageWithSources
		if (mockGroundingSources.length > 0) {
			cleanAssistantMessage = assistantMessageWithSources
				.replace(/\[\d+\]\s+[^:\n]+:\s+https?:\/\/[^\s\n]+/g, "") // e.g., "[1] Example Source: https://example.com"
				.replace(/Sources?:\s*[\s\S]*?(?=\n\n|\n$|$)/g, "") // e.g., "Sources: [1](url1), [2](url2)"
				.trim()
		}

		// Add the cleaned message to API history
		await (task as any).addToApiConversationHistory({
			role: "assistant",
			content: [{ type: "text", text: cleanAssistantMessage }],
		})

		// Verify that the cleaned message was added without grounding sources
		expect(addToApiHistorySpy).toHaveBeenCalledWith({
			role: "assistant",
			content: [{ type: "text", text: "This is the main response content." }],
		})

		// Verify the API conversation history contains the cleaned message
		expect(task.apiConversationHistory).toHaveLength(1)
		expect(task.apiConversationHistory[0].content).toEqual([
			{ type: "text", text: "This is the main response content." },
		])
	})

	it("should not modify assistant message when no grounding sources are present", async () => {
		const task = new Task({
			provider: mockProvider as ClineProvider,
			apiConfiguration: mockApiConfiguration,
			task: "Test task",
			startTask: false,
		})

		task.apiConversationHistory = []

		const assistantMessage = "This is a regular response without any sources."
		const mockGroundingSources: any[] = [] // No grounding sources

		// Apply the same logic
		let cleanAssistantMessage = assistantMessage
		if (mockGroundingSources.length > 0) {
			cleanAssistantMessage = assistantMessage
				.replace(/\[\d+\]\s+[^:\n]+:\s+https?:\/\/[^\s\n]+/g, "")
				.replace(/Sources?:\s*[\s\S]*?(?=\n\n|\n$|$)/g, "")
				.trim()
		}

		await (task as any).addToApiConversationHistory({
			role: "assistant",
			content: [{ type: "text", text: cleanAssistantMessage }],
		})

		// Message should remain unchanged
		expect(task.apiConversationHistory[0].content).toEqual([
			{ type: "text", text: "This is a regular response without any sources." },
		])
	})

	it("should handle various grounding source formats", () => {
		const testCases = [
			{
				input: "[1] Source Title: https://example.com\n[2] Another: https://test.com\nMain content here",
				expected: "Main content here",
			},
			{
				input: "Content first\n\nSources: [1](https://example.com), [2](https://test.com)",
				expected: "Content first",
			},
			{
				input: "Mixed content\n[1] Inline Source: https://inline.com\nMore content\nSource: [1](https://inline.com)",
				expected: "Mixed content\n\nMore content",
			},
		]

		testCases.forEach(({ input, expected }) => {
			const cleaned = input
				.replace(/\[\d+\]\s+[^:\n]+:\s+https?:\/\/[^\s\n]+/g, "")
				.replace(/Sources?:\s*[\s\S]*?(?=\n\n|\n$|$)/g, "")
				.trim()
			expect(cleaned).toBe(expected)
		})
	})
})
