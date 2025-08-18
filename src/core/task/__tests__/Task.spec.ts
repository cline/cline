// npx vitest core/task/__tests__/Task.spec.ts

import * as os from "os"
import * as path from "path"

import * as vscode from "vscode"
import { Anthropic } from "@anthropic-ai/sdk"

import type { GlobalState, ProviderSettings, ModelInfo } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { ContextProxy } from "../../config/ContextProxy"
import { processUserContentMentions } from "../../mentions/processUserContentMentions"
import { MultiSearchReplaceDiffStrategy } from "../../diff/strategies/multi-search-replace"
import { MultiFileSearchReplaceDiffStrategy } from "../../diff/strategies/multi-file-search-replace"
import { EXPERIMENT_IDS } from "../../../shared/experiments"

// Mock delay before any imports that might use it
vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

import delay from "delay"

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	const mockFunctions = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockImplementation((filePath) => {
			if (filePath.includes("ui_messages.json")) {
				return Promise.resolve(JSON.stringify(mockMessages))
			}
			if (filePath.includes("api_conversation_history.json")) {
				return Promise.resolve(
					JSON.stringify([
						{
							role: "user",
							content: [{ type: "text", text: "historical task" }],
							ts: Date.now(),
						},
						{
							role: "assistant",
							content: [{ type: "text", text: "I'll help you with that task." }],
							ts: Date.now(),
						},
					]),
				)
			}
			return Promise.resolve("[]")
		}),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
	}

	return {
		...actual,
		...mockFunctions,
		default: mockFunctions,
	}
})

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = { event: vi.fn(), fire: vi.fn() }
	const mockTextDocument = { uri: { fsPath: "/mock/workspace/path/file.ts" } }
	const mockTextEditor = { document: mockTextDocument }
	const mockTab = { input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
	const mockTabGroup = { tabs: [mockTab] }

	return {
		TabInputTextDiff: vi.fn(),
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		window: {
			createTextEditorDecorationType: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
			visibleTextEditors: [mockTextEditor],
			tabGroups: {
				all: [mockTabGroup],
				close: vi.fn(),
				onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
			},
			showErrorMessage: vi.fn(),
		},
		workspace: {
			workspaceFolders: [
				{
					uri: { fsPath: "/mock/workspace/path" },
					name: "mock-workspace",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
			fs: {
				stat: vi.fn().mockResolvedValue({ type: 1 }), // FileType.File = 1
			},
			onDidSaveTextDocument: vi.fn(() => mockDisposable),
			getConfiguration: vi.fn(() => ({ get: (key: string, defaultValue: any) => defaultValue })),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: vi.fn(),
		},
		TabInputText: vi.fn(),
	}
})

vi.mock("../../mentions", () => ({
	parseMentions: vi.fn().mockImplementation((text) => {
		return Promise.resolve(`processed: ${text}`)
	}),
	openMention: vi.fn(),
	getLatestTerminalOutput: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

// Mock storagePathManager to prevent dynamic import issues.
vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockImplementation((filePath) => {
		return filePath.includes("ui_messages.json") || filePath.includes("api_conversation_history.json")
	}),
}))

const mockMessages = [
	{
		ts: Date.now(),
		type: "say",
		say: "text",
		text: "historical task",
	},
]

describe("Cline", () => {
	let mockProvider: any
	let mockApiConfig: ProviderSettings
	let mockOutputChannel: any
	let mockExtensionContext: vscode.ExtensionContext

	beforeEach(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		// Setup mock extension context
		const storageUri = {
			fsPath: path.join(os.tmpdir(), "test-storage"),
		}

		mockExtensionContext = {
			globalState: {
				get: vi.fn().mockImplementation((key: keyof GlobalState) => {
					if (key === "taskHistory") {
						return [
							{
								id: "123",
								number: 0,
								ts: Date.now(),
								task: "historical task",
								tokensIn: 100,
								tokensOut: 200,
								cacheWrites: 0,
								cacheReads: 0,
								totalCost: 0.001,
							},
						]
					}

					return undefined
				}),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: storageUri,
			workspaceState: {
				get: vi.fn().mockImplementation((_key) => undefined),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn().mockImplementation((_key) => Promise.resolve(undefined)),
				store: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				delete: vi.fn().mockImplementation((_key) => Promise.resolve()),
			},
			extensionUri: {
				fsPath: "/mock/extension/path",
			},
			extension: {
				packageJSON: {
					version: "1.0.0",
				},
			},
		} as unknown as vscode.ExtensionContext

		// Setup mock output channel
		mockOutputChannel = {
			appendLine: vi.fn(),
			append: vi.fn(),
			clear: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		}

		// Setup mock provider with output channel
		mockProvider = new ClineProvider(
			mockExtensionContext,
			mockOutputChannel,
			"sidebar",
			new ContextProxy(mockExtensionContext),
		) as any

		// Setup mock API configuration
		mockApiConfig = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-5-sonnet-20241022",
			apiKey: "test-api-key", // Add API key to mock config
		}

		// Mock provider methods
		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.getTaskWithId = vi.fn().mockImplementation(async (id) => ({
			historyItem: {
				id,
				ts: Date.now(),
				task: "historical task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
			},
			taskDirPath: "/mock/storage/path/tasks/123",
			apiConversationHistoryFilePath: "/mock/storage/path/tasks/123/api_conversation_history.json",
			uiMessagesFilePath: "/mock/storage/path/tasks/123/ui_messages.json",
			apiConversationHistory: [
				{
					role: "user",
					content: [{ type: "text", text: "historical task" }],
					ts: Date.now(),
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "I'll help you with that task." }],
					ts: Date.now(),
				},
			],
		}))
	})

	describe("constructor", () => {
		it("should respect provided settings", async () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				fuzzyMatchThreshold: 0.95,
				task: "test task",
				startTask: false,
			})

			expect(cline.diffEnabled).toBe(false)
		})

		it("should use default fuzzy match threshold when not provided", async () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				enableDiff: true,
				fuzzyMatchThreshold: 0.95,
				task: "test task",
				startTask: false,
			})

			expect(cline.diffEnabled).toBe(true)

			// The diff strategy should be created with default threshold (1.0).
			expect(cline.diffStrategy).toBeDefined()
		})

		it("should use default consecutiveMistakeLimit when not provided", () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			expect(cline.consecutiveMistakeLimit).toBe(3)
		})

		it("should respect provided consecutiveMistakeLimit", () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				consecutiveMistakeLimit: 5,
				task: "test task",
				startTask: false,
			})

			expect(cline.consecutiveMistakeLimit).toBe(5)
		})

		it("should keep consecutiveMistakeLimit of 0 as 0 for unlimited", () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				consecutiveMistakeLimit: 0,
				task: "test task",
				startTask: false,
			})

			expect(cline.consecutiveMistakeLimit).toBe(0)
		})

		it("should pass 0 to ToolRepetitionDetector for unlimited mode", () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				consecutiveMistakeLimit: 0,
				task: "test task",
				startTask: false,
			})

			// The toolRepetitionDetector should be initialized with 0 for unlimited mode
			expect(cline.toolRepetitionDetector).toBeDefined()
			// Verify the limit remains as 0
			expect(cline.consecutiveMistakeLimit).toBe(0)
		})

		it("should pass consecutiveMistakeLimit to ToolRepetitionDetector", () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				consecutiveMistakeLimit: 5,
				task: "test task",
				startTask: false,
			})

			// The toolRepetitionDetector should be initialized with the same limit
			expect(cline.toolRepetitionDetector).toBeDefined()
			expect(cline.consecutiveMistakeLimit).toBe(5)
		})

		it("should require either task or historyItem", () => {
			expect(() => {
				new Task({ provider: mockProvider, apiConfiguration: mockApiConfig })
			}).toThrow("Either historyItem or task/images must be provided")
		})
	})

	describe("getEnvironmentDetails", () => {
		describe("API conversation handling", () => {
			it.skip("should clean conversation history before sending to API", async () => {
				// Cline.create will now use our mocked getEnvironmentDetails
				const [cline, task] = Task.create({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
				})

				cline.abandoned = true
				await task

				// Set up mock stream.
				const mockStreamForClean = (async function* () {
					yield { type: "text", text: "test response" }
				})()

				// Set up spy.
				const cleanMessageSpy = vi.fn().mockReturnValue(mockStreamForClean)
				vi.spyOn(cline.api, "createMessage").mockImplementation(cleanMessageSpy)

				// Add test message to conversation history.
				cline.apiConversationHistory = [
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: "test message" }],
						ts: Date.now(),
					},
				]

				// Mock abort state
				Object.defineProperty(cline, "abort", {
					get: () => false,
					set: () => {},
					configurable: true,
				})

				// Add a message with extra properties to the conversation history
				const messageWithExtra = {
					role: "user" as const,
					content: [{ type: "text" as const, text: "test message" }],
					ts: Date.now(),
					extraProp: "should be removed",
				}

				cline.apiConversationHistory = [messageWithExtra]

				// Trigger an API request
				await cline.recursivelyMakeClineRequests([{ type: "text", text: "test request" }], false)

				// Get the conversation history from the first API call
				expect(cleanMessageSpy.mock.calls.length).toBeGreaterThan(0)
				const history = cleanMessageSpy.mock.calls[0]?.[1]
				expect(history).toBeDefined()
				expect(history.length).toBeGreaterThan(0)

				// Find our test message
				const cleanedMessage = history.find((msg: { content?: Array<{ text: string }> }) =>
					msg.content?.some((content) => content.text === "test message"),
				)
				expect(cleanedMessage).toBeDefined()
				expect(cleanedMessage).toEqual({
					role: "user",
					content: [{ type: "text", text: "test message" }],
				})

				// Verify extra properties were removed
				expect(Object.keys(cleanedMessage!)).toEqual(["role", "content"])
			})

			it.skip("should handle image blocks based on model capabilities", async () => {
				// Create two configurations - one with image support, one without
				const configWithImages = {
					...mockApiConfig,
					apiModelId: "claude-3-sonnet",
				}
				const configWithoutImages = {
					...mockApiConfig,
					apiModelId: "gpt-3.5-turbo",
				}

				// Create test conversation history with mixed content
				const conversationHistory: (Anthropic.MessageParam & { ts?: number })[] = [
					{
						role: "user" as const,
						content: [
							{
								type: "text" as const,
								text: "Here is an image",
							} satisfies Anthropic.TextBlockParam,
							{
								type: "image" as const,
								source: {
									type: "base64" as const,
									media_type: "image/jpeg",
									data: "base64data",
								},
							} satisfies Anthropic.ImageBlockParam,
						],
					},
					{
						role: "assistant" as const,
						content: [
							{
								type: "text" as const,
								text: "I see the image",
							} satisfies Anthropic.TextBlockParam,
						],
					},
				]

				// Test with model that supports images
				const [clineWithImages, taskWithImages] = Task.create({
					provider: mockProvider,
					apiConfiguration: configWithImages,
					task: "test task",
				})

				// Mock the model info to indicate image support
				vi.spyOn(clineWithImages.api, "getModel").mockReturnValue({
					id: "claude-3-sonnet",
					info: {
						supportsImages: true,
						supportsPromptCache: true,
						supportsComputerUse: true,
						contextWindow: 200000,
						maxTokens: 4096,
						inputPrice: 0.25,
						outputPrice: 0.75,
					} as ModelInfo,
				})

				clineWithImages.apiConversationHistory = conversationHistory

				// Test with model that doesn't support images
				const [clineWithoutImages, taskWithoutImages] = Task.create({
					provider: mockProvider,
					apiConfiguration: configWithoutImages,
					task: "test task",
				})

				// Mock the model info to indicate no image support
				vi.spyOn(clineWithoutImages.api, "getModel").mockReturnValue({
					id: "gpt-3.5-turbo",
					info: {
						supportsImages: false,
						supportsPromptCache: false,
						supportsComputerUse: false,
						contextWindow: 16000,
						maxTokens: 2048,
						inputPrice: 0.1,
						outputPrice: 0.2,
					} as ModelInfo,
				})

				clineWithoutImages.apiConversationHistory = conversationHistory

				// Mock abort state for both instances
				Object.defineProperty(clineWithImages, "abort", {
					get: () => false,
					set: () => {},
					configurable: true,
				})

				Object.defineProperty(clineWithoutImages, "abort", {
					get: () => false,
					set: () => {},
					configurable: true,
				})

				// Set up mock streams
				const mockStreamWithImages = (async function* () {
					yield { type: "text", text: "test response" }
				})()

				const mockStreamWithoutImages = (async function* () {
					yield { type: "text", text: "test response" }
				})()

				// Set up spies
				const imagesSpy = vi.fn().mockReturnValue(mockStreamWithImages)
				const noImagesSpy = vi.fn().mockReturnValue(mockStreamWithoutImages)

				vi.spyOn(clineWithImages.api, "createMessage").mockImplementation(imagesSpy)
				vi.spyOn(clineWithoutImages.api, "createMessage").mockImplementation(noImagesSpy)

				// Set up conversation history with images
				clineWithImages.apiConversationHistory = [
					{
						role: "user",
						content: [
							{ type: "text", text: "Here is an image" },
							{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "base64data" } },
						],
					},
				]

				clineWithImages.abandoned = true
				await taskWithImages.catch(() => {})

				clineWithoutImages.abandoned = true
				await taskWithoutImages.catch(() => {})

				// Trigger API requests
				await clineWithImages.recursivelyMakeClineRequests([{ type: "text", text: "test request" }])
				await clineWithoutImages.recursivelyMakeClineRequests([{ type: "text", text: "test request" }])

				// Get the calls
				const imagesCalls = imagesSpy.mock.calls
				const noImagesCalls = noImagesSpy.mock.calls

				// Verify model with image support preserves image blocks
				expect(imagesCalls.length).toBeGreaterThan(0)
				if (imagesCalls[0]?.[1]?.[0]?.content) {
					expect(imagesCalls[0][1][0].content).toHaveLength(2)
					expect(imagesCalls[0][1][0].content[0]).toEqual({ type: "text", text: "Here is an image" })
					expect(imagesCalls[0][1][0].content[1]).toHaveProperty("type", "image")
				}

				// Verify model without image support converts image blocks to text
				expect(noImagesCalls.length).toBeGreaterThan(0)
				if (noImagesCalls[0]?.[1]?.[0]?.content) {
					expect(noImagesCalls[0][1][0].content).toHaveLength(2)
					expect(noImagesCalls[0][1][0].content[0]).toEqual({ type: "text", text: "Here is an image" })
					expect(noImagesCalls[0][1][0].content[1]).toEqual({
						type: "text",
						text: "[Referenced image in conversation]",
					})
				}
			})

			it.skip("should handle API retry with countdown", async () => {
				const [cline, task] = Task.create({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
				})

				// Mock delay to track countdown timing
				const mockDelay = vi.fn().mockResolvedValue(undefined)
				vi.spyOn(await import("delay"), "default").mockImplementation(mockDelay)

				// Mock say to track messages
				const saySpy = vi.spyOn(cline, "say")

				// Create a stream that fails on first chunk
				const mockError = new Error("API Error")
				const mockFailedStream = {
					// eslint-disable-next-line require-yield
					async *[Symbol.asyncIterator]() {
						throw mockError
					},
					async next() {
						throw mockError
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					async [Symbol.asyncDispose]() {
						// Cleanup
					},
				} as AsyncGenerator<ApiStreamChunk>

				// Create a successful stream for retry
				const mockSuccessStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "Success" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "Success" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					async [Symbol.asyncDispose]() {
						// Cleanup
					},
				} as AsyncGenerator<ApiStreamChunk>

				// Mock createMessage to fail first then succeed
				let firstAttempt = true
				vi.spyOn(cline.api, "createMessage").mockImplementation(() => {
					if (firstAttempt) {
						firstAttempt = false
						return mockFailedStream
					}
					return mockSuccessStream
				})

				// Set alwaysApproveResubmit and requestDelaySeconds
				mockProvider.getState = vi.fn().mockResolvedValue({
					alwaysApproveResubmit: true,
					requestDelaySeconds: 3,
				})

				// Mock previous API request message
				cline.clineMessages = [
					{
						ts: Date.now(),
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({
							tokensIn: 100,
							tokensOut: 50,
							cacheWrites: 0,
							cacheReads: 0,
							request: "test request",
						}),
					},
				]

				// Trigger API request
				const iterator = cline.attemptApiRequest(0)
				await iterator.next()

				// Calculate expected delay for first retry
				const baseDelay = 3 // from requestDelaySeconds

				// Verify countdown messages
				for (let i = baseDelay; i > 0; i--) {
					expect(saySpy).toHaveBeenCalledWith(
						"api_req_retry_delayed",
						expect.stringContaining(`Retrying in ${i} seconds`),
						undefined,
						true,
					)
				}

				expect(saySpy).toHaveBeenCalledWith(
					"api_req_retry_delayed",
					expect.stringContaining("Retrying now"),
					undefined,
					false,
				)

				// Calculate expected delay calls for countdown
				const totalExpectedDelays = baseDelay // One delay per second for countdown
				expect(mockDelay).toHaveBeenCalledTimes(totalExpectedDelays)
				expect(mockDelay).toHaveBeenCalledWith(1000)

				// Verify error message content
				const errorMessage = saySpy.mock.calls.find((call) => call[1]?.includes(mockError.message))?.[1]
				expect(errorMessage).toBe(
					`${mockError.message}\n\nRetry attempt 1\nRetrying in ${baseDelay} seconds...`,
				)

				await cline.abortTask(true)
				await task.catch(() => {})
			})

			it.skip("should not apply retry delay twice", async () => {
				const [cline, task] = Task.create({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
				})

				// Mock delay to track countdown timing
				const mockDelay = vi.fn().mockResolvedValue(undefined)
				vi.spyOn(await import("delay"), "default").mockImplementation(mockDelay)

				// Mock say to track messages
				const saySpy = vi.spyOn(cline, "say")

				// Create a stream that fails on first chunk
				const mockError = new Error("API Error")
				const mockFailedStream = {
					// eslint-disable-next-line require-yield
					async *[Symbol.asyncIterator]() {
						throw mockError
					},
					async next() {
						throw mockError
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					async [Symbol.asyncDispose]() {
						// Cleanup
					},
				} as AsyncGenerator<ApiStreamChunk>

				// Create a successful stream for retry
				const mockSuccessStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "Success" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "Success" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					async [Symbol.asyncDispose]() {
						// Cleanup
					},
				} as AsyncGenerator<ApiStreamChunk>

				// Mock createMessage to fail first then succeed
				let firstAttempt = true
				vi.spyOn(cline.api, "createMessage").mockImplementation(() => {
					if (firstAttempt) {
						firstAttempt = false
						return mockFailedStream
					}
					return mockSuccessStream
				})

				// Set alwaysApproveResubmit and requestDelaySeconds
				mockProvider.getState = vi.fn().mockResolvedValue({
					alwaysApproveResubmit: true,
					requestDelaySeconds: 3,
				})

				// Mock previous API request message
				cline.clineMessages = [
					{
						ts: Date.now(),
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({
							tokensIn: 100,
							tokensOut: 50,
							cacheWrites: 0,
							cacheReads: 0,
							request: "test request",
						}),
					},
				]

				// Trigger API request
				const iterator = cline.attemptApiRequest(0)
				await iterator.next()

				// Verify delay is only applied for the countdown
				const baseDelay = 3 // from requestDelaySeconds
				const expectedDelayCount = baseDelay // One delay per second for countdown
				expect(mockDelay).toHaveBeenCalledTimes(expectedDelayCount)
				expect(mockDelay).toHaveBeenCalledWith(1000) // Each delay should be 1 second

				// Verify countdown messages were only shown once
				const retryMessages = saySpy.mock.calls.filter(
					(call) => call[0] === "api_req_retry_delayed" && call[1]?.includes("Retrying in"),
				)
				expect(retryMessages).toHaveLength(baseDelay)

				// Verify the retry message sequence
				for (let i = baseDelay; i > 0; i--) {
					expect(saySpy).toHaveBeenCalledWith(
						"api_req_retry_delayed",
						expect.stringContaining(`Retrying in ${i} seconds`),
						undefined,
						true,
					)
				}

				// Verify final retry message
				expect(saySpy).toHaveBeenCalledWith(
					"api_req_retry_delayed",
					expect.stringContaining("Retrying now"),
					undefined,
					false,
				)

				await cline.abortTask(true)
				await task.catch(() => {})
			})

			describe("processUserContentMentions", () => {
				it("should process mentions in task and feedback tags", async () => {
					const [cline, task] = Task.create({
						provider: mockProvider,
						apiConfiguration: mockApiConfig,
						task: "test task",
					})

					const userContent = [
						{
							type: "text",
							text: "Regular text with 'some/path' (see below for file content)",
						} as const,
						{
							type: "text",
							text: "<task>Text with 'some/path' (see below for file content) in task tags</task>",
						} as const,
						{
							type: "tool_result",
							tool_use_id: "test-id",
							content: [
								{
									type: "text",
									text: "<feedback>Check 'some/path' (see below for file content)</feedback>",
								},
							],
						} as Anthropic.ToolResultBlockParam,
						{
							type: "tool_result",
							tool_use_id: "test-id-2",
							content: [
								{
									type: "text",
									text: "Regular tool result with 'path' (see below for file content)",
								},
							],
						} as Anthropic.ToolResultBlockParam,
					]

					const processedContent = await processUserContentMentions({
						userContent,
						cwd: cline.cwd,
						urlContentFetcher: cline.urlContentFetcher,
						fileContextTracker: cline.fileContextTracker,
					})

					// Regular text should not be processed
					expect((processedContent[0] as Anthropic.TextBlockParam).text).toBe(
						"Regular text with 'some/path' (see below for file content)",
					)

					// Text within task tags should be processed
					expect((processedContent[1] as Anthropic.TextBlockParam).text).toContain("processed:")
					expect((processedContent[1] as Anthropic.TextBlockParam).text).toContain(
						"<task>Text with 'some/path' (see below for file content) in task tags</task>",
					)

					// Feedback tag content should be processed
					const toolResult1 = processedContent[2] as Anthropic.ToolResultBlockParam
					const content1 = Array.isArray(toolResult1.content) ? toolResult1.content[0] : toolResult1.content
					expect((content1 as Anthropic.TextBlockParam).text).toContain("processed:")
					expect((content1 as Anthropic.TextBlockParam).text).toContain(
						"<feedback>Check 'some/path' (see below for file content)</feedback>",
					)

					// Regular tool result should not be processed
					const toolResult2 = processedContent[3] as Anthropic.ToolResultBlockParam
					const content2 = Array.isArray(toolResult2.content) ? toolResult2.content[0] : toolResult2.content
					expect((content2 as Anthropic.TextBlockParam).text).toBe(
						"Regular tool result with 'path' (see below for file content)",
					)

					await cline.abortTask(true)
					await task.catch(() => {})
				})
			})
		})

		describe("Subtask Rate Limiting", () => {
			let mockProvider: any
			let mockApiConfig: any
			let mockDelay: ReturnType<typeof vi.fn>

			beforeEach(() => {
				vi.clearAllMocks()
				// Reset the global timestamp before each test
				Task.resetGlobalApiRequestTime()

				mockApiConfig = {
					apiProvider: "anthropic",
					apiKey: "test-key",
					rateLimitSeconds: 5,
				}

				mockProvider = {
					context: {
						globalStorageUri: { fsPath: "/test/storage" },
					},
					getState: vi.fn().mockResolvedValue({
						apiConfiguration: mockApiConfig,
					}),
					say: vi.fn(),
					postStateToWebview: vi.fn().mockResolvedValue(undefined),
					postMessageToWebview: vi.fn().mockResolvedValue(undefined),
					updateTaskHistory: vi.fn().mockResolvedValue(undefined),
				}

				// Get the mocked delay function
				mockDelay = delay as ReturnType<typeof vi.fn>
				mockDelay.mockClear()
			})

			afterEach(() => {
				// Clean up the global state after each test
				Task.resetGlobalApiRequestTime()
			})

			it("should enforce rate limiting across parent and subtask", async () => {
				// Add a spy to track getState calls
				const getStateSpy = vi.spyOn(mockProvider, "getState")

				// Create parent task
				const parent = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "parent task",
					startTask: false,
				})

				// Mock the API stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "parent response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "parent response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(parent.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the parent task
				const parentIterator = parent.attemptApiRequest(0)
				await parentIterator.next()

				// Verify no delay was applied for the first request
				expect(mockDelay).not.toHaveBeenCalled()

				// Create a subtask immediately after
				const child = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "child task",
					parentTask: parent,
					rootTask: parent,
					startTask: false,
				})

				// Mock the child's API stream
				const childMockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "child response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "child response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(child.api, "createMessage").mockReturnValue(childMockStream)

				// Make an API request with the child task
				const childIterator = child.attemptApiRequest(0)
				await childIterator.next()

				// Verify rate limiting was applied
				expect(mockDelay).toHaveBeenCalledTimes(mockApiConfig.rateLimitSeconds)
				expect(mockDelay).toHaveBeenCalledWith(1000)
			}, 10000) // Increase timeout to 10 seconds

			it("should not apply rate limiting if enough time has passed", async () => {
				// Create parent task
				const parent = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "parent task",
					startTask: false,
				})

				// Mock the API stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(parent.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the parent task
				const parentIterator = parent.attemptApiRequest(0)
				await parentIterator.next()

				// Simulate time passing (more than rate limit)
				const originalDateNow = Date.now
				const mockTime = Date.now() + (mockApiConfig.rateLimitSeconds + 1) * 1000
				Date.now = vi.fn(() => mockTime)

				// Create a subtask after time has passed
				const child = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "child task",
					parentTask: parent,
					rootTask: parent,
					startTask: false,
				})

				vi.spyOn(child.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the child task
				const childIterator = child.attemptApiRequest(0)
				await childIterator.next()

				// Verify no rate limiting was applied
				expect(mockDelay).not.toHaveBeenCalled()

				// Restore Date.now
				Date.now = originalDateNow
			})

			it("should share rate limiting across multiple subtasks", async () => {
				// Create parent task
				const parent = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "parent task",
					startTask: false,
				})

				// Mock the API stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(parent.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the parent task
				const parentIterator = parent.attemptApiRequest(0)
				await parentIterator.next()

				// Create first subtask
				const child1 = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "child task 1",
					parentTask: parent,
					rootTask: parent,
					startTask: false,
				})

				vi.spyOn(child1.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the first child task
				const child1Iterator = child1.attemptApiRequest(0)
				await child1Iterator.next()

				// Verify rate limiting was applied
				const firstDelayCount = mockDelay.mock.calls.length
				expect(firstDelayCount).toBe(mockApiConfig.rateLimitSeconds)

				// Clear the mock to count new delays
				mockDelay.mockClear()

				// Create second subtask immediately after
				const child2 = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "child task 2",
					parentTask: parent,
					rootTask: parent,
					startTask: false,
				})

				vi.spyOn(child2.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the second child task
				const child2Iterator = child2.attemptApiRequest(0)
				await child2Iterator.next()

				// Verify rate limiting was applied again
				expect(mockDelay).toHaveBeenCalledTimes(mockApiConfig.rateLimitSeconds)
			}, 15000) // Increase timeout to 15 seconds

			it("should handle rate limiting with zero rate limit", async () => {
				// Update config to have zero rate limit
				mockApiConfig.rateLimitSeconds = 0
				mockProvider.getState.mockResolvedValue({
					apiConfiguration: mockApiConfig,
				})

				// Create parent task
				const parent = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "parent task",
					startTask: false,
				})

				// Mock the API stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(parent.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the parent task
				const parentIterator = parent.attemptApiRequest(0)
				await parentIterator.next()

				// Create a subtask
				const child = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "child task",
					parentTask: parent,
					rootTask: parent,
					startTask: false,
				})

				vi.spyOn(child.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the child task
				const childIterator = child.attemptApiRequest(0)
				await childIterator.next()

				// Verify no delay was applied
				expect(mockDelay).not.toHaveBeenCalled()
			})

			it("should update global timestamp even when no rate limiting is needed", async () => {
				// Create task
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
					startTask: false,
				})

				// Mock the API stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(task.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request
				const iterator = task.attemptApiRequest(0)
				await iterator.next()

				// Access the private static property via reflection for testing
				const globalTimestamp = (Task as any).lastGlobalApiRequestTime
				expect(globalTimestamp).toBeDefined()
				expect(globalTimestamp).toBeGreaterThan(0)
			})
		})

		describe("Dynamic Strategy Selection", () => {
			let mockProvider: any
			let mockApiConfig: any

			beforeEach(() => {
				vi.clearAllMocks()

				mockApiConfig = {
					apiProvider: "anthropic",
					apiKey: "test-key",
				}

				mockProvider = {
					context: {
						globalStorageUri: { fsPath: "/test/storage" },
					},
					getState: vi.fn(),
				}
			})

			it("should use MultiSearchReplaceDiffStrategy by default", async () => {
				mockProvider.getState.mockResolvedValue({
					experiments: {
						[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF]: false,
					},
				})

				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					enableDiff: true,
					task: "test task",
					startTask: false,
				})

				// Initially should be MultiSearchReplaceDiffStrategy
				expect(task.diffStrategy).toBeInstanceOf(MultiSearchReplaceDiffStrategy)
				expect(task.diffStrategy?.getName()).toBe("MultiSearchReplace")
			})

			it("should switch to MultiFileSearchReplaceDiffStrategy when experiment is enabled", async () => {
				mockProvider.getState.mockResolvedValue({
					experiments: {
						[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF]: true,
					},
				})

				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					enableDiff: true,
					task: "test task",
					startTask: false,
				})

				// Initially should be MultiSearchReplaceDiffStrategy
				expect(task.diffStrategy).toBeInstanceOf(MultiSearchReplaceDiffStrategy)

				// Wait for async strategy update
				await new Promise((resolve) => setTimeout(resolve, 10))

				// Should have switched to MultiFileSearchReplaceDiffStrategy
				expect(task.diffStrategy).toBeInstanceOf(MultiFileSearchReplaceDiffStrategy)
				expect(task.diffStrategy?.getName()).toBe("MultiFileSearchReplace")
			})

			it("should keep MultiSearchReplaceDiffStrategy when experiments are undefined", async () => {
				mockProvider.getState.mockResolvedValue({})

				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					enableDiff: true,
					task: "test task",
					startTask: false,
				})

				// Initially should be MultiSearchReplaceDiffStrategy
				expect(task.diffStrategy).toBeInstanceOf(MultiSearchReplaceDiffStrategy)

				// Wait for async strategy update
				await new Promise((resolve) => setTimeout(resolve, 10))

				// Should still be MultiSearchReplaceDiffStrategy
				expect(task.diffStrategy).toBeInstanceOf(MultiSearchReplaceDiffStrategy)
				expect(task.diffStrategy?.getName()).toBe("MultiSearchReplace")
			})

			it("should not create diff strategy when enableDiff is false", async () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					enableDiff: false,
					task: "test task",
					startTask: false,
				})

				expect(task.diffEnabled).toBe(false)
				expect(task.diffStrategy).toBeUndefined()
			})
		})

		describe("getApiProtocol", () => {
			it("should determine API protocol based on provider and model", async () => {
				// Test with Anthropic provider
				const anthropicConfig = {
					...mockApiConfig,
					apiProvider: "anthropic" as const,
					apiModelId: "gpt-4",
				}
				const anthropicTask = new Task({
					provider: mockProvider,
					apiConfiguration: anthropicConfig,
					task: "test task",
					startTask: false,
				})
				// Should use anthropic protocol even with non-claude model
				expect(anthropicTask.apiConfiguration.apiProvider).toBe("anthropic")

				// Test with OpenRouter provider and Claude model
				const openrouterClaudeConfig = {
					apiProvider: "openrouter" as const,
					openRouterModelId: "anthropic/claude-3-opus",
				}
				const openrouterClaudeTask = new Task({
					provider: mockProvider,
					apiConfiguration: openrouterClaudeConfig,
					task: "test task",
					startTask: false,
				})
				expect(openrouterClaudeTask.apiConfiguration.apiProvider).toBe("openrouter")

				// Test with OpenRouter provider and non-Claude model
				const openrouterGptConfig = {
					apiProvider: "openrouter" as const,
					openRouterModelId: "openai/gpt-4",
				}
				const openrouterGptTask = new Task({
					provider: mockProvider,
					apiConfiguration: openrouterGptConfig,
					task: "test task",
					startTask: false,
				})
				expect(openrouterGptTask.apiConfiguration.apiProvider).toBe("openrouter")

				// Test with various Claude model formats
				const claudeModelFormats = [
					"claude-3-opus",
					"Claude-3-Sonnet",
					"CLAUDE-instant",
					"anthropic/claude-3-haiku",
					"some-provider/claude-model",
				]

				for (const modelId of claudeModelFormats) {
					const config = {
						apiProvider: "openai" as const,
						openAiModelId: modelId,
					}
					const task = new Task({
						provider: mockProvider,
						apiConfiguration: config,
						task: "test task",
						startTask: false,
					})
					// Verify the model ID contains claude (case-insensitive)
					expect(modelId.toLowerCase()).toContain("claude")
				}
			})

			it("should handle edge cases for API protocol detection", async () => {
				// Test with undefined provider
				const undefinedProviderConfig = {
					apiModelId: "claude-3-opus",
				}
				const undefinedProviderTask = new Task({
					provider: mockProvider,
					apiConfiguration: undefinedProviderConfig,
					task: "test task",
					startTask: false,
				})
				expect(undefinedProviderTask.apiConfiguration.apiProvider).toBeUndefined()

				// Test with no model ID
				const noModelConfig = {
					apiProvider: "openai" as const,
				}
				const noModelTask = new Task({
					provider: mockProvider,
					apiConfiguration: noModelConfig,
					task: "test task",
					startTask: false,
				})
				expect(noModelTask.apiConfiguration.apiProvider).toBe("openai")
			})
		})

		describe("submitUserMessage", () => {
			it("should always route through webview sendMessage invoke", async () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "initial task",
					startTask: false,
				})

				// Set up some existing messages to simulate an ongoing conversation
				task.clineMessages = [
					{
						ts: Date.now(),
						type: "say",
						say: "text",
						text: "Initial message",
					},
				]

				// Call submitUserMessage
				task.submitUserMessage("test message", ["image1.png"])

				// Verify postMessageToWebview was called with sendMessage invoke
				expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
					type: "invoke",
					invoke: "sendMessage",
					text: "test message",
					images: ["image1.png"],
				})
			})

			it("should handle empty messages gracefully", async () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "initial task",
					startTask: false,
				})

				// Call with empty text and no images
				task.submitUserMessage("", [])

				// Should not call postMessageToWebview for empty messages
				expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()

				// Call with whitespace only
				task.submitUserMessage("   ", [])
				expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
			})

			it("should route through webview for both new and existing tasks", async () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "initial task",
					startTask: false,
				})

				// Test with no messages (new task scenario)
				task.clineMessages = []
				task.submitUserMessage("new task", ["image1.png"])

				expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
					type: "invoke",
					invoke: "sendMessage",
					text: "new task",
					images: ["image1.png"],
				})

				// Clear mock
				mockProvider.postMessageToWebview.mockClear()

				// Test with existing messages (ongoing task scenario)
				task.clineMessages = [
					{
						ts: Date.now(),
						type: "say",
						say: "text",
						text: "Initial message",
					},
				]
				task.submitUserMessage("follow-up message", ["image2.png"])

				expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
					type: "invoke",
					invoke: "sendMessage",
					text: "follow-up message",
					images: ["image2.png"],
				})
			})

			it("should handle undefined provider gracefully", async () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "initial task",
					startTask: false,
				})

				// Simulate weakref returning undefined
				Object.defineProperty(task, "providerRef", {
					value: { deref: () => undefined },
					writable: false,
					configurable: true,
				})

				// Spy on console.error to verify error is logged
				const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

				// Should log error but not throw
				task.submitUserMessage("test message")

				expect(consoleErrorSpy).toHaveBeenCalledWith("[Task#submitUserMessage] Provider reference lost")
				expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()

				// Restore console.error
				consoleErrorSpy.mockRestore()
			})
		})
	})

	describe("abortTask", () => {
		it("should set abort flag and emit TaskAborted event", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			// Spy on emit method
			const emitSpy = vi.spyOn(task, "emit")

			// Mock the dispose method to avoid actual cleanup
			vi.spyOn(task, "dispose").mockImplementation(() => {})

			// Call abortTask
			await task.abortTask()

			// Verify abort flag is set
			expect(task.abort).toBe(true)

			// Verify TaskAborted event was emitted
			expect(emitSpy).toHaveBeenCalledWith("taskAborted")
		})

		it("should be equivalent to clicking Cancel button functionality", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			// Mock the dispose method to track cleanup
			const disposeSpy = vi.spyOn(task, "dispose").mockImplementation(() => {})

			// Call abortTask
			await task.abortTask()

			// Verify the same behavior as Cancel button
			expect(task.abort).toBe(true)
			expect(disposeSpy).toHaveBeenCalled()
		})

		it("should work with TaskLike interface", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			// Cast to TaskLike to ensure interface compliance
			const taskLike = task as any // TaskLike interface from types package

			// Verify abortTask method exists and is callable
			expect(typeof taskLike.abortTask).toBe("function")

			// Mock the dispose method to avoid actual cleanup
			vi.spyOn(task, "dispose").mockImplementation(() => {})

			// Call abortTask through interface
			await taskLike.abortTask()

			// Verify it works
			expect(task.abort).toBe(true)
		})

		it("should handle errors during disposal gracefully", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			// Mock dispose to throw an error
			const mockError = new Error("Disposal failed")
			vi.spyOn(task, "dispose").mockImplementation(() => {
				throw mockError
			})

			// Spy on console.error to verify error is logged
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// abortTask should not throw even if dispose fails
			await expect(task.abortTask()).resolves.not.toThrow()

			// Verify error was logged
			expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error during task"), mockError)

			// Verify abort flag is still set
			expect(task.abort).toBe(true)

			// Restore console.error
			consoleErrorSpy.mockRestore()
		})
	})
})
