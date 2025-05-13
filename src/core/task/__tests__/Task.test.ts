// npx jest src/core/task/__tests__/Task.test.ts

import * as os from "os"
import * as path from "path"

import * as vscode from "vscode"
import { Anthropic } from "@anthropic-ai/sdk"

import { GlobalState } from "../../../schemas"
import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ProviderSettings, ModelInfo } from "../../../shared/api"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { ContextProxy } from "../../config/ContextProxy"
import { processUserContentMentions } from "../../mentions/processUserContentMentions"

jest.mock("execa", () => ({
	execa: jest.fn(),
}))

jest.mock("fs/promises", () => ({
	mkdir: jest.fn().mockResolvedValue(undefined),
	writeFile: jest.fn().mockResolvedValue(undefined),
	readFile: jest.fn().mockImplementation((filePath) => {
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
	unlink: jest.fn().mockResolvedValue(undefined),
	rmdir: jest.fn().mockResolvedValue(undefined),
}))

jest.mock("p-wait-for", () => ({
	__esModule: true,
	default: jest.fn().mockImplementation(async () => Promise.resolve()),
}))

jest.mock("vscode", () => {
	const mockDisposable = { dispose: jest.fn() }
	const mockEventEmitter = { event: jest.fn(), fire: jest.fn() }
	const mockTextDocument = { uri: { fsPath: "/mock/workspace/path/file.ts" } }
	const mockTextEditor = { document: mockTextDocument }
	const mockTab = { input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
	const mockTabGroup = { tabs: [mockTab] }

	return {
		TabInputTextDiff: jest.fn(),
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		window: {
			createTextEditorDecorationType: jest.fn().mockReturnValue({
				dispose: jest.fn(),
			}),
			visibleTextEditors: [mockTextEditor],
			tabGroups: {
				all: [mockTabGroup],
				close: jest.fn(),
				onDidChangeTabs: jest.fn(() => ({ dispose: jest.fn() })),
			},
			showErrorMessage: jest.fn(),
		},
		workspace: {
			workspaceFolders: [
				{
					uri: { fsPath: "/mock/workspace/path" },
					name: "mock-workspace",
					index: 0,
				},
			],
			createFileSystemWatcher: jest.fn(() => ({
				onDidCreate: jest.fn(() => mockDisposable),
				onDidDelete: jest.fn(() => mockDisposable),
				onDidChange: jest.fn(() => mockDisposable),
				dispose: jest.fn(),
			})),
			fs: {
				stat: jest.fn().mockResolvedValue({ type: 1 }), // FileType.File = 1
			},
			onDidSaveTextDocument: jest.fn(() => mockDisposable),
			getConfiguration: jest.fn(() => ({ get: (key: string, defaultValue: any) => defaultValue })),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: jest.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: jest.fn(),
		},
		TabInputText: jest.fn(),
	}
})

jest.mock("../../mentions", () => ({
	parseMentions: jest.fn().mockImplementation((text) => {
		return Promise.resolve(`processed: ${text}`)
	}),
	openMention: jest.fn(),
	getLatestTerminalOutput: jest.fn(),
}))

jest.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: jest.fn().mockResolvedValue("Mock file content"),
}))

jest.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: jest.fn().mockResolvedValue(""),
}))

// Mock RooIgnoreController
jest.mock("../../ignore/RooIgnoreController")

// Mock storagePathManager to prevent dynamic import issues
jest.mock("../../../shared/storagePathManager", () => ({
	getTaskDirectoryPath: jest
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: jest
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
}))

// Mock fileExistsAtPath
jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockImplementation((filePath) => {
		return filePath.includes("ui_messages.json") || filePath.includes("api_conversation_history.json")
	}),
}))

// Mock fs/promises
const mockMessages = [
	{
		ts: Date.now(),
		type: "say",
		say: "text",
		text: "historical task",
	},
]

describe("Cline", () => {
	let mockProvider: jest.Mocked<ClineProvider>
	let mockApiConfig: ProviderSettings
	let mockOutputChannel: any
	let mockExtensionContext: vscode.ExtensionContext

	beforeEach(() => {
		// Setup mock extension context
		const storageUri = {
			fsPath: path.join(os.tmpdir(), "test-storage"),
		}

		mockExtensionContext = {
			globalState: {
				get: jest.fn().mockImplementation((key: keyof GlobalState) => {
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
				update: jest.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: jest.fn().mockReturnValue([]),
			},
			globalStorageUri: storageUri,
			workspaceState: {
				get: jest.fn().mockImplementation((_key) => undefined),
				update: jest.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: jest.fn().mockReturnValue([]),
			},
			secrets: {
				get: jest.fn().mockImplementation((_key) => Promise.resolve(undefined)),
				store: jest.fn().mockImplementation((_key, _value) => Promise.resolve()),
				delete: jest.fn().mockImplementation((_key) => Promise.resolve()),
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
			appendLine: jest.fn(),
			append: jest.fn(),
			clear: jest.fn(),
			show: jest.fn(),
			hide: jest.fn(),
			dispose: jest.fn(),
		}

		// Setup mock provider with output channel
		mockProvider = new ClineProvider(
			mockExtensionContext,
			mockOutputChannel,
			"sidebar",
			new ContextProxy(mockExtensionContext),
		) as jest.Mocked<ClineProvider>

		// Setup mock API configuration
		mockApiConfig = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-5-sonnet-20241022",
			apiKey: "test-api-key", // Add API key to mock config
		}

		// Mock provider methods
		mockProvider.postMessageToWebview = jest.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = jest.fn().mockResolvedValue(undefined)
		mockProvider.getTaskWithId = jest.fn().mockImplementation(async (id) => ({
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
				customInstructions: "custom instructions",
				fuzzyMatchThreshold: 0.95,
				task: "test task",
				startTask: false,
			})

			expect(cline.customInstructions).toBe("custom instructions")
			expect(cline.diffEnabled).toBe(false)
		})

		it("should use default fuzzy match threshold when not provided", async () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				customInstructions: "custom instructions",
				enableDiff: true,
				fuzzyMatchThreshold: 0.95,
				task: "test task",
				startTask: false,
			})

			expect(cline.diffEnabled).toBe(true)

			// The diff strategy should be created with default threshold (1.0).
			expect(cline.diffStrategy).toBeDefined()
		})

		it("should require either task or historyItem", () => {
			expect(() => {
				new Task({ provider: mockProvider, apiConfiguration: mockApiConfig })
			}).toThrow("Either historyItem or task/images must be provided")
		})
	})

	describe("getEnvironmentDetails", () => {
		describe("API conversation handling", () => {
			it("should clean conversation history before sending to API", async () => {
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
				const cleanMessageSpy = jest.fn().mockReturnValue(mockStreamForClean)
				jest.spyOn(cline.api, "createMessage").mockImplementation(cleanMessageSpy)

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
				const history = cleanMessageSpy.mock.calls[0][1]
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

			it("should handle image blocks based on model capabilities", async () => {
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
				jest.spyOn(clineWithImages.api, "getModel").mockReturnValue({
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
				jest.spyOn(clineWithoutImages.api, "getModel").mockReturnValue({
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
				const imagesSpy = jest.fn().mockReturnValue(mockStreamWithImages)
				const noImagesSpy = jest.fn().mockReturnValue(mockStreamWithoutImages)

				jest.spyOn(clineWithImages.api, "createMessage").mockImplementation(imagesSpy)
				jest.spyOn(clineWithoutImages.api, "createMessage").mockImplementation(noImagesSpy)

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
				expect(imagesCalls[0][1][0].content).toHaveLength(2)
				expect(imagesCalls[0][1][0].content[0]).toEqual({ type: "text", text: "Here is an image" })
				expect(imagesCalls[0][1][0].content[1]).toHaveProperty("type", "image")

				// Verify model without image support converts image blocks to text
				expect(noImagesCalls[0][1][0].content).toHaveLength(2)
				expect(noImagesCalls[0][1][0].content[0]).toEqual({ type: "text", text: "Here is an image" })
				expect(noImagesCalls[0][1][0].content[1]).toEqual({
					type: "text",
					text: "[Referenced image in conversation]",
				})
			})

			it.skip("should handle API retry with countdown", async () => {
				const [cline, task] = Task.create({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
				})

				// Mock delay to track countdown timing
				const mockDelay = jest.fn().mockResolvedValue(undefined)
				jest.spyOn(require("delay"), "default").mockImplementation(mockDelay)

				// Mock say to track messages
				const saySpy = jest.spyOn(cline, "say")

				// Create a stream that fails on first chunk
				const mockError = new Error("API Error")
				const mockFailedStream = {
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
				jest.spyOn(cline.api, "createMessage").mockImplementation(() => {
					if (firstAttempt) {
						firstAttempt = false
						return mockFailedStream
					}
					return mockSuccessStream
				})

				// Set alwaysApproveResubmit and requestDelaySeconds
				mockProvider.getState = jest.fn().mockResolvedValue({
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
				const mockDelay = jest.fn().mockResolvedValue(undefined)
				jest.spyOn(require("delay"), "default").mockImplementation(mockDelay)

				// Mock say to track messages
				const saySpy = jest.spyOn(cline, "say")

				// Create a stream that fails on first chunk
				const mockError = new Error("API Error")
				const mockFailedStream = {
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
				jest.spyOn(cline.api, "createMessage").mockImplementation(() => {
					if (firstAttempt) {
						firstAttempt = false
						return mockFailedStream
					}
					return mockSuccessStream
				})

				// Set alwaysApproveResubmit and requestDelaySeconds
				mockProvider.getState = jest.fn().mockResolvedValue({
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
							text: "Regular text with @/some/path",
						} as const,
						{
							type: "text",
							text: "<task>Text with @/some/path in task tags</task>",
						} as const,
						{
							type: "tool_result",
							tool_use_id: "test-id",
							content: [
								{
									type: "text",
									text: "<feedback>Check @/some/path</feedback>",
								},
							],
						} as Anthropic.ToolResultBlockParam,
						{
							type: "tool_result",
							tool_use_id: "test-id-2",
							content: [
								{
									type: "text",
									text: "Regular tool result with @/path",
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
					expect((processedContent[0] as Anthropic.TextBlockParam).text).toBe("Regular text with @/some/path")

					// Text within task tags should be processed
					expect((processedContent[1] as Anthropic.TextBlockParam).text).toContain("processed:")
					expect((processedContent[1] as Anthropic.TextBlockParam).text).toContain(
						"<task>Text with @/some/path in task tags</task>",
					)

					// Feedback tag content should be processed
					const toolResult1 = processedContent[2] as Anthropic.ToolResultBlockParam
					const content1 = Array.isArray(toolResult1.content) ? toolResult1.content[0] : toolResult1.content
					expect((content1 as Anthropic.TextBlockParam).text).toContain("processed:")
					expect((content1 as Anthropic.TextBlockParam).text).toContain(
						"<feedback>Check @/some/path</feedback>",
					)

					// Regular tool result should not be processed
					const toolResult2 = processedContent[3] as Anthropic.ToolResultBlockParam
					const content2 = Array.isArray(toolResult2.content) ? toolResult2.content[0] : toolResult2.content
					expect((content2 as Anthropic.TextBlockParam).text).toBe("Regular tool result with @/path")

					await cline.abortTask(true)
					await task.catch(() => {})
				})
			})
		})
	})
})
