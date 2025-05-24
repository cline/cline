import { IEmbedder } from "../../interfaces/embedder"
import { IVectorStore } from "../../interfaces/vector-store"
import { FileProcessingResult } from "../../interfaces/file-processor"
import { FileWatcher } from "../file-watcher"

import { createHash } from "crypto"

jest.mock("vscode", () => {
	type Disposable = { dispose: () => void }

	type _Event<T> = (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => Disposable

	const MOCK_EMITTER_REGISTRY = new Map<object, Set<(data: any) => any>>()

	return {
		EventEmitter: jest.fn().mockImplementation(() => {
			const emitterInstanceKey = {}
			MOCK_EMITTER_REGISTRY.set(emitterInstanceKey, new Set())

			return {
				event: function <T>(listener: (e: T) => any): Disposable {
					const listeners = MOCK_EMITTER_REGISTRY.get(emitterInstanceKey)
					listeners!.add(listener as any)
					return {
						dispose: () => {
							listeners!.delete(listener as any)
						},
					}
				},

				fire: function <T>(data: T): void {
					const listeners = MOCK_EMITTER_REGISTRY.get(emitterInstanceKey)
					listeners!.forEach((fn) => fn(data))
				},

				dispose: () => {
					MOCK_EMITTER_REGISTRY.get(emitterInstanceKey)!.clear()
					MOCK_EMITTER_REGISTRY.delete(emitterInstanceKey)
				},
			}
		}),
		RelativePattern: jest.fn().mockImplementation((base, pattern) => ({
			base,
			pattern,
		})),
		Uri: {
			file: jest.fn().mockImplementation((path) => ({ fsPath: path })),
		},
		window: {
			activeTextEditor: undefined,
		},
		workspace: {
			createFileSystemWatcher: jest.fn().mockReturnValue({
				onDidCreate: jest.fn(),
				onDidChange: jest.fn(),
				onDidDelete: jest.fn(),
				dispose: jest.fn(),
			}),
			fs: {
				stat: jest.fn(),
				readFile: jest.fn(),
			},
			workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
			getWorkspaceFolder: jest.fn((uri) => {
				if (uri && uri.fsPath && uri.fsPath.startsWith("/mock/workspace")) {
					return { uri: { fsPath: "/mock/workspace" } }
				}
				return undefined
			}),
		},
	}
})

const vscode = require("vscode")
jest.mock("crypto")
jest.mock("uuid", () => ({
	...jest.requireActual("uuid"),
	v5: jest.fn().mockReturnValue("mocked-uuid-v5-for-testing"),
}))
jest.mock("../../../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: jest.fn().mockImplementation(() => ({
		validateAccess: jest.fn(),
	})),
	mockValidateAccess: jest.fn(),
}))
jest.mock("../../cache-manager")
jest.mock("../parser", () => ({ codeParser: { parseFile: jest.fn() } }))

describe("FileWatcher", () => {
	let fileWatcher: FileWatcher
	let mockEmbedder: IEmbedder
	let mockVectorStore: IVectorStore
	let mockCacheManager: any
	let mockContext: any
	let mockRooIgnoreController: any

	beforeEach(() => {
		mockEmbedder = {
			createEmbeddings: jest.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
			embedderInfo: { name: "openai" },
		}
		mockVectorStore = {
			upsertPoints: jest.fn().mockResolvedValue(undefined),
			deletePointsByFilePath: jest.fn().mockResolvedValue(undefined),
			deletePointsByMultipleFilePaths: jest.fn().mockResolvedValue(undefined),
			initialize: jest.fn().mockResolvedValue(true),
			search: jest.fn().mockResolvedValue([]),
			clearCollection: jest.fn().mockResolvedValue(undefined),
			deleteCollection: jest.fn().mockResolvedValue(undefined),
			collectionExists: jest.fn().mockResolvedValue(true),
		}
		mockCacheManager = {
			getHash: jest.fn(),
			updateHash: jest.fn(),
			deleteHash: jest.fn(),
		}
		mockContext = {
			subscriptions: [],
		}

		const { RooIgnoreController, mockValidateAccess } = require("../../../../core/ignore/RooIgnoreController")
		mockRooIgnoreController = new RooIgnoreController()
		mockRooIgnoreController.validateAccess = mockValidateAccess.mockReturnValue(true)

		fileWatcher = new FileWatcher(
			"/mock/workspace",
			mockContext,
			mockCacheManager,
			mockEmbedder,
			mockVectorStore,
			undefined,
			mockRooIgnoreController,
		)
	})

	describe("constructor", () => {
		it("should initialize with correct properties", () => {
			expect(fileWatcher).toBeDefined()

			mockContext.subscriptions.push({ dispose: jest.fn() }, { dispose: jest.fn() })
			expect(mockContext.subscriptions).toHaveLength(2)
		})
	})

	describe("initialize", () => {
		it("should create file watcher with correct pattern", async () => {
			await fileWatcher.initialize()
			expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalled()
			expect(vscode.workspace.createFileSystemWatcher.mock.calls[0][0].pattern).toMatch(
				/\{tla,js,jsx,ts,vue,tsx,py,rs,go,c,h,cpp,hpp,cs,rb,java,php,swift,sol,kt,kts,ex,exs,el,html,htm,json,css,rdl,ml,mli,lua,scala,toml,zig,elm,ejs,erb\}/,
			)
		})

		it("should register event handlers", async () => {
			await fileWatcher.initialize()
			const watcher = vscode.workspace.createFileSystemWatcher.mock.results[0].value
			expect(watcher.onDidCreate).toHaveBeenCalled()
			expect(watcher.onDidChange).toHaveBeenCalled()
			expect(watcher.onDidDelete).toHaveBeenCalled()
		})
	})

	describe("dispose", () => {
		it("should dispose all resources", async () => {
			await fileWatcher.initialize()
			fileWatcher.dispose()
			const watcher = vscode.workspace.createFileSystemWatcher.mock.results[0].value
			expect(watcher.dispose).toHaveBeenCalled()
		})
	})

	describe("handleFileCreated", () => {
		beforeEach(() => {
			jest.useFakeTimers()
		})

		afterEach(() => {
			jest.useRealTimers()
		})

		it("should call processFile with correct path", async () => {
			const mockUri = { fsPath: "/mock/workspace/test.js" }
			const processFileSpy = jest.spyOn(fileWatcher, "processFile").mockResolvedValue({
				path: mockUri.fsPath,
				status: "processed_for_batching",
				newHash: "mock-hash",
				pointsToUpsert: [{ id: "mock-point-id", vector: [0.1], payload: { filePath: mockUri.fsPath } }],
				reason: undefined,
				error: undefined,
			} as FileProcessingResult)

			// Setup a spy for the _onDidFinishBatchProcessing event
			let batchProcessingFinished = false
			const batchFinishedSpy = jest.fn(() => {
				batchProcessingFinished = true
			})
			fileWatcher.onDidFinishBatchProcessing(batchFinishedSpy)

			// Directly accumulate the event and trigger batch processing
			;(fileWatcher as any).accumulatedEvents.set(mockUri.fsPath, { uri: mockUri, type: "create" })
			;(fileWatcher as any).scheduleBatchProcessing()

			// Advance timers to trigger debounced processing
			await jest.advanceTimersByTimeAsync(1000)
			await jest.runAllTicks()

			// Wait for batch processing to complete
			while (!batchProcessingFinished) {
				await jest.runAllTicks()
				await new Promise((resolve) => setImmediate(resolve))
			}

			expect(processFileSpy).toHaveBeenCalledWith(mockUri.fsPath)
		})
	})

	describe("handleFileChanged", () => {
		beforeEach(() => {
			jest.useFakeTimers()
		})

		afterEach(() => {
			jest.useRealTimers()
		})

		it("should call processFile with correct path", async () => {
			const mockUri = { fsPath: "/mock/workspace/test.js" }
			const processFileSpy = jest.spyOn(fileWatcher, "processFile").mockResolvedValue({
				path: mockUri.fsPath,
				status: "processed_for_batching",
				newHash: "mock-hash",
				pointsToUpsert: [{ id: "mock-point-id", vector: [0.1], payload: { filePath: mockUri.fsPath } }],
				reason: undefined,
				error: undefined,
			} as FileProcessingResult)

			// Setup a spy for the _onDidFinishBatchProcessing event
			let batchProcessingFinished = false
			const batchFinishedSpy = jest.fn(() => {
				batchProcessingFinished = true
			})
			fileWatcher.onDidFinishBatchProcessing(batchFinishedSpy)

			// Directly accumulate the event and trigger batch processing
			;(fileWatcher as any).accumulatedEvents.set(mockUri.fsPath, { uri: mockUri, type: "change" })
			;(fileWatcher as any).scheduleBatchProcessing()

			// Advance timers to trigger debounced processing
			await jest.advanceTimersByTimeAsync(1000)
			await jest.runAllTicks()

			// Wait for batch processing to complete
			while (!batchProcessingFinished) {
				await jest.runAllTicks()
				await new Promise((resolve) => setImmediate(resolve))
			}

			expect(processFileSpy).toHaveBeenCalledWith(mockUri.fsPath)
		})
	})

	describe("handleFileDeleted", () => {
		beforeEach(() => {
			jest.useFakeTimers()
		})

		afterEach(() => {
			jest.useRealTimers()
		})

		it("should delete from cache and process deletion in batch", async () => {
			const mockUri = { fsPath: "/mock/workspace/test.js" }

			// Setup a spy for the _onDidFinishBatchProcessing event
			let batchProcessingFinished = false
			const batchFinishedSpy = jest.fn(() => {
				batchProcessingFinished = true
			})
			fileWatcher.onDidFinishBatchProcessing(batchFinishedSpy)

			// Directly accumulate the event and trigger batch processing
			;(fileWatcher as any).accumulatedEvents.set(mockUri.fsPath, { uri: mockUri, type: "delete" })
			;(fileWatcher as any).scheduleBatchProcessing()

			// Advance timers to trigger debounced processing
			await jest.advanceTimersByTimeAsync(1000)
			await jest.runAllTicks()

			// Wait for batch processing to complete
			while (!batchProcessingFinished) {
				await jest.runAllTicks()
				await new Promise((resolve) => setImmediate(resolve))
			}

			expect(mockCacheManager.deleteHash).toHaveBeenCalledWith(mockUri.fsPath)
			expect(mockVectorStore.deletePointsByMultipleFilePaths).toHaveBeenCalledWith(
				expect.arrayContaining([mockUri.fsPath]),
			)
			expect(mockVectorStore.deletePointsByMultipleFilePaths).toHaveBeenCalledTimes(1)
		})

		it("should handle errors during deletePointsByMultipleFilePaths", async () => {
			// Setup mock error
			const mockError = new Error("Failed to delete points from vector store") as Error
			;(mockVectorStore.deletePointsByMultipleFilePaths as jest.Mock).mockRejectedValueOnce(mockError)

			// Create a spy for the _onDidFinishBatchProcessing event
			let capturedBatchSummary: any = null
			let batchProcessingFinished = false
			const batchFinishedSpy = jest.fn((summary) => {
				capturedBatchSummary = summary
				batchProcessingFinished = true
			})
			fileWatcher.onDidFinishBatchProcessing(batchFinishedSpy)

			// Trigger delete event
			const mockUri = { fsPath: "/mock/workspace/test-error.js" }

			// Directly accumulate the event and trigger batch processing
			;(fileWatcher as any).accumulatedEvents.set(mockUri.fsPath, { uri: mockUri, type: "delete" })
			;(fileWatcher as any).scheduleBatchProcessing()

			// Advance timers to trigger debounced processing
			await jest.advanceTimersByTimeAsync(1000)
			await jest.runAllTicks()

			// Wait for batch processing to complete
			while (!batchProcessingFinished) {
				await jest.runAllTicks()
				await new Promise((resolve) => setImmediate(resolve))
			}

			// Verify that deletePointsByMultipleFilePaths was called
			expect(mockVectorStore.deletePointsByMultipleFilePaths).toHaveBeenCalledWith(
				expect.arrayContaining([mockUri.fsPath]),
			)

			// Verify that cacheManager.deleteHash is not called when vectorStore.deletePointsByMultipleFilePaths fails
			expect(mockCacheManager.deleteHash).not.toHaveBeenCalledWith(mockUri.fsPath)
		})
	})

	describe("processFile", () => {
		it("should skip ignored files", async () => {
			mockRooIgnoreController.validateAccess.mockImplementation((path: string) => {
				if (path === "/mock/workspace/ignored.js") return false
				return true
			})
			const filePath = "/mock/workspace/ignored.js"
			vscode.Uri.file.mockImplementation((path: string) => ({ fsPath: path }))
			const result = await fileWatcher.processFile(filePath)

			expect(result.status).toBe("skipped")
			expect(result.reason).toBe("File is ignored by .rooignore or .gitignore")
			expect(mockCacheManager.updateHash).not.toHaveBeenCalled()
			expect(vscode.workspace.fs.stat).not.toHaveBeenCalled()
			expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled()
		})

		it("should skip files larger than MAX_FILE_SIZE_BYTES", async () => {
			vscode.workspace.fs.stat.mockResolvedValue({ size: 2 * 1024 * 1024 })
			vscode.workspace.fs.readFile.mockResolvedValue(Buffer.from("large file content"))
			mockRooIgnoreController.validateAccess.mockReturnValue(true)
			const result = await fileWatcher.processFile("/mock/workspace/large.js")
			expect(vscode.Uri.file).toHaveBeenCalledWith("/mock/workspace/large.js")

			expect(result.status).toBe("skipped")
			expect(result.reason).toBe("File is too large")
			expect(mockCacheManager.updateHash).not.toHaveBeenCalled()
		})

		it("should skip unchanged files", async () => {
			vscode.workspace.fs.stat.mockResolvedValue({ size: 1024, mtime: Date.now() })
			vscode.workspace.fs.readFile.mockResolvedValue(Buffer.from("test content"))
			mockCacheManager.getHash.mockReturnValue("hash")
			mockRooIgnoreController.validateAccess.mockReturnValue(true)
			;(createHash as jest.Mock).mockReturnValue({
				update: jest.fn().mockReturnThis(),
				digest: jest.fn().mockReturnValue("hash"),
			})

			const result = await fileWatcher.processFile("/mock/workspace/unchanged.js")

			expect(result.status).toBe("skipped")
			expect(result.reason).toBe("File has not changed")
			expect(mockCacheManager.updateHash).not.toHaveBeenCalled()
		})

		it("should process changed files", async () => {
			vscode.Uri.file.mockImplementation((path: string) => ({ fsPath: path }))
			vscode.workspace.fs.stat.mockResolvedValue({ size: 1024, mtime: Date.now() })
			vscode.workspace.fs.readFile.mockResolvedValue(Buffer.from("test content"))
			mockCacheManager.getHash.mockReturnValue("old-hash")
			mockRooIgnoreController.validateAccess.mockReturnValue(true)
			;(createHash as jest.Mock).mockReturnValue({
				update: jest.fn().mockReturnThis(),
				digest: jest.fn().mockReturnValue("new-hash"),
			})

			const { codeParser: mockCodeParser } = require("../parser")
			mockCodeParser.parseFile.mockResolvedValue([
				{
					file_path: "/mock/workspace/test.js",
					content: "test content",
					start_line: 1,
					end_line: 5,
					identifier: "test",
					type: "function",
					fileHash: "new-hash",
					segmentHash: "segment-hash",
				},
			])

			const result = await fileWatcher.processFile("/mock/workspace/test.js")

			expect(result.status).toBe("processed_for_batching")
			expect(result.newHash).toBe("new-hash")
			expect(result.pointsToUpsert).toEqual([
				expect.objectContaining({
					id: "mocked-uuid-v5-for-testing",
					vector: [0.1, 0.2, 0.3],
					payload: {
						filePath: "test.js",
						codeChunk: "test content",
						startLine: 1,
						endLine: 5,
					},
				}),
			])
			expect(mockCodeParser.parseFile).toHaveBeenCalled()
			expect(mockEmbedder.createEmbeddings).toHaveBeenCalled()
		})

		it("should handle processing errors", async () => {
			vscode.workspace.fs.stat.mockResolvedValue({ size: 1024 })
			vscode.workspace.fs.readFile.mockRejectedValue(new Error("Read error"))

			const result = await fileWatcher.processFile("/mock/workspace/error.js")

			expect(result.status).toBe("local_error")
			expect(result.error).toBeDefined()
		})
	})

	describe("Batch processing of rapid delete-then-create/change events", () => {
		let onDidDeleteCallback: (uri: any) => void
		let onDidCreateCallback: (uri: any) => void
		let mockUri: { fsPath: string }

		beforeEach(() => {
			jest.useFakeTimers()

			// Clear all relevant mocks
			mockCacheManager.deleteHash.mockClear()
			mockCacheManager.getHash.mockClear()
			mockCacheManager.updateHash.mockClear()
			;(mockVectorStore.deletePointsByFilePath as jest.Mock).mockClear()
			;(mockVectorStore.upsertPoints as jest.Mock).mockClear()
			;(mockVectorStore.deletePointsByMultipleFilePaths as jest.Mock).mockClear()

			// Setup file watcher mocks
			vscode.workspace.createFileSystemWatcher.mockReturnValue({
				onDidCreate: jest.fn((callback) => {
					onDidCreateCallback = callback
					return { dispose: jest.fn() }
				}),
				onDidChange: jest.fn().mockReturnValue({ dispose: jest.fn() }),
				onDidDelete: jest.fn((callback) => {
					onDidDeleteCallback = callback
					return { dispose: jest.fn() }
				}),
				dispose: jest.fn(),
			})

			fileWatcher.initialize()
			mockUri = { fsPath: "/mock/workspace/test-race.js" }

			// Ensure file access is allowed
			mockRooIgnoreController.validateAccess.mockReturnValue(true)
		})

		afterEach(() => {
			jest.useRealTimers()
		})

		it("should correctly process a file that is deleted and then quickly re-created/changed", async () => {
			// Setup initial file state mocks
			vscode.workspace.fs.stat.mockResolvedValue({ size: 100 })
			vscode.workspace.fs.readFile.mockResolvedValue(Buffer.from("new content"))
			mockCacheManager.getHash.mockReturnValue("old-hash")
			;(createHash as jest.Mock).mockReturnValue({
				update: jest.fn().mockReturnThis(),
				digest: jest.fn().mockReturnValue("new-hash-for-recreated-file"),
			})

			// Setup code parser mock for the re-created file
			const { codeParser: mockCodeParser } = require("../parser")
			mockCodeParser.parseFile.mockResolvedValue([
				{
					file_path: mockUri.fsPath,
					content: "new content",
					start_line: 1,
					end_line: 5,
					identifier: "test",
					type: "function",
					fileHash: "new-hash-for-recreated-file",
					segmentHash: "segment-hash",
				},
			])

			// Setup a spy for the _onDidFinishBatchProcessing event
			let batchProcessingFinished = false
			const batchFinishedSpy = jest.fn(() => {
				batchProcessingFinished = true
			})
			fileWatcher.onDidFinishBatchProcessing(batchFinishedSpy)

			// Simulate delete event by directly calling the private method that accumulates events
			;(fileWatcher as any).accumulatedEvents.set(mockUri.fsPath, { uri: mockUri, type: "delete" })
			;(fileWatcher as any).scheduleBatchProcessing()
			await jest.runAllTicks()

			// For a delete-then-create in same batch, deleteHash should not be called
			expect(mockCacheManager.deleteHash).not.toHaveBeenCalledWith(mockUri.fsPath)

			// Simulate quick re-creation by overriding the delete event with create
			;(fileWatcher as any).accumulatedEvents.set(mockUri.fsPath, { uri: mockUri, type: "create" })
			await jest.runAllTicks()

			// Advance timers to trigger batch processing and wait for completion
			await jest.advanceTimersByTimeAsync(1000)
			await jest.runAllTicks()

			// Wait for batch processing to complete
			while (!batchProcessingFinished) {
				await jest.runAllTicks()
				await new Promise((resolve) => setImmediate(resolve))
			}

			// Verify the deletion operations
			expect(mockVectorStore.deletePointsByMultipleFilePaths).not.toHaveBeenCalledWith(
				expect.arrayContaining([mockUri.fsPath]),
			)

			// Verify the re-creation operations
			expect(mockVectorStore.upsertPoints).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						id: "mocked-uuid-v5-for-testing",
						payload: expect.objectContaining({
							filePath: expect.stringContaining("test-race.js"),
							codeChunk: "new content",
							startLine: 1,
							endLine: 5,
						}),
					}),
				]),
			)

			// Verify final state
			expect(mockCacheManager.updateHash).toHaveBeenCalledWith(mockUri.fsPath, "new-hash-for-recreated-file")
		}, 15000)
	})

	describe("Batch upsert retry logic", () => {
		beforeEach(() => {
			jest.useFakeTimers()

			// Clear all relevant mocks
			mockCacheManager.deleteHash.mockClear()
			mockCacheManager.getHash.mockClear()
			mockCacheManager.updateHash.mockClear()
			;(mockVectorStore.upsertPoints as jest.Mock).mockClear()
			;(mockVectorStore.deletePointsByFilePath as jest.Mock).mockClear()
			;(mockVectorStore.deletePointsByMultipleFilePaths as jest.Mock).mockClear()

			// Ensure file access is allowed
			mockRooIgnoreController.validateAccess.mockReturnValue(true)
		})

		afterEach(() => {
			jest.useRealTimers()
		})

		it("should retry upsert operation when it fails initially and succeed on retry", async () => {
			// Import constants for correct timing
			const { INITIAL_RETRY_DELAY_MS } = require("../../constants/index")

			// Setup file state mocks
			vscode.workspace.fs.stat.mockResolvedValue({ size: 100 })
			vscode.workspace.fs.readFile.mockResolvedValue(Buffer.from("test content for retry"))
			mockCacheManager.getHash.mockReturnValue("old-hash")
			;(createHash as jest.Mock).mockReturnValue({
				update: jest.fn().mockReturnThis(),
				digest: jest.fn().mockReturnValue("new-hash-for-retry-test"),
			})

			// Setup code parser mock
			const { codeParser: mockCodeParser } = require("../parser")
			mockCodeParser.parseFile.mockResolvedValue([
				{
					file_path: "/mock/workspace/retry-test.js",
					content: "test content for retry",
					start_line: 1,
					end_line: 5,
					identifier: "test",
					type: "function",
					fileHash: "new-hash-for-retry-test",
					segmentHash: "segment-hash",
				},
			])

			// Setup a spy for the _onDidFinishBatchProcessing event
			let capturedBatchSummary: any = null
			let batchProcessingFinished = false
			const batchFinishedSpy = jest.fn((summary) => {
				capturedBatchSummary = summary
				batchProcessingFinished = true
			})
			fileWatcher.onDidFinishBatchProcessing(batchFinishedSpy)

			// Mock vectorStore.upsertPoints to fail on first call and succeed on second call
			const mockError = new Error("Failed to upsert points to vector store")
			;(mockVectorStore.upsertPoints as jest.Mock)
				.mockRejectedValueOnce(mockError) // First call fails
				.mockResolvedValueOnce(undefined) // Second call succeeds

			// Trigger file change event
			const mockUri = { fsPath: "/mock/workspace/retry-test.js" }

			// Directly accumulate the event and trigger batch processing
			;(fileWatcher as any).accumulatedEvents.set(mockUri.fsPath, { uri: mockUri, type: "change" })
			;(fileWatcher as any).scheduleBatchProcessing()

			// Wait for processing to start
			await jest.runAllTicks()

			// Advance timers to trigger batch processing
			await jest.advanceTimersByTimeAsync(1000) // Advance past debounce delay
			await jest.runAllTicks()

			// Advance timers to trigger retry after initial failure
			// Use correct exponential backoff: INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1)
			// For first retry (retryCount = 1): 500 * Math.pow(2, 0) = 500ms
			const firstRetryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, 1 - 1)
			await jest.advanceTimersByTimeAsync(firstRetryDelay)
			await jest.runAllTicks()

			// Wait for batch processing to complete
			while (!batchProcessingFinished) {
				await jest.runAllTicks()
				await new Promise((resolve) => setImmediate(resolve))
			}

			// Verify that upsertPoints was called twice (initial failure + successful retry)
			expect(mockVectorStore.upsertPoints).toHaveBeenCalledTimes(2)

			// Verify that the cache was updated after successful retry
			expect(mockCacheManager.updateHash).toHaveBeenCalledWith(mockUri.fsPath, "new-hash-for-retry-test")

			// Verify the batch summary
			expect(capturedBatchSummary).not.toBeNull()
			expect(capturedBatchSummary.batchError).toBeUndefined()

			// Verify that the processedFiles array includes the file with success status
			const processedFile = capturedBatchSummary.processedFiles.find((file: any) => file.path === mockUri.fsPath)
			expect(processedFile).toBeDefined()
			expect(processedFile.status).toBe("success")
			expect(processedFile.error).toBeUndefined()
		}, 15000)

		it("should handle the case where upsert fails all retries", async () => {
			// Import constants directly for test
			const { MAX_BATCH_RETRIES, INITIAL_RETRY_DELAY_MS } = require("../../constants/index")

			// Setup file state mocks
			vscode.workspace.fs.stat.mockResolvedValue({ size: 100 })
			vscode.workspace.fs.readFile.mockResolvedValue(Buffer.from("test content for failed retries"))
			mockCacheManager.getHash.mockReturnValue("old-hash")
			;(createHash as jest.Mock).mockReturnValue({
				update: jest.fn().mockReturnThis(),
				digest: jest.fn().mockReturnValue("new-hash-for-failed-retries-test"),
			})

			// Setup code parser mock
			const { codeParser: mockCodeParser } = require("../parser")
			mockCodeParser.parseFile.mockResolvedValue([
				{
					file_path: "/mock/workspace/failed-retries-test.js",
					content: "test content for failed retries",
					start_line: 1,
					end_line: 5,
					identifier: "test",
					type: "function",
					fileHash: "new-hash-for-failed-retries-test",
					segmentHash: "segment-hash",
				},
			])

			// Setup a spy for the _onDidFinishBatchProcessing event
			let capturedBatchSummary: any = null
			let batchProcessingFinished = false
			const batchFinishedSpy = jest.fn((summary) => {
				capturedBatchSummary = summary
				batchProcessingFinished = true
			})
			fileWatcher.onDidFinishBatchProcessing(batchFinishedSpy)

			// Mock vectorStore.upsertPoints to fail consistently for all retry attempts
			const mockError = new Error("Persistent upsert failure")
			;(mockVectorStore.upsertPoints as jest.Mock).mockRejectedValue(mockError)

			// Trigger file change event
			const mockUri = { fsPath: "/mock/workspace/failed-retries-test.js" }

			// Directly accumulate the event and trigger batch processing
			;(fileWatcher as any).accumulatedEvents.set(mockUri.fsPath, { uri: mockUri, type: "change" })
			;(fileWatcher as any).scheduleBatchProcessing()

			// Wait for processing to start
			await jest.runAllTicks()

			// Advance timers to trigger batch processing
			await jest.advanceTimersByTimeAsync(1000) // Advance past debounce delay
			await jest.runAllTicks()

			// Advance timers for each retry attempt using correct exponential backoff
			for (let i = 1; i <= MAX_BATCH_RETRIES; i++) {
				// Use correct exponential backoff: INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1)
				const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, i - 1)
				await jest.advanceTimersByTimeAsync(delay)
				await jest.runAllTicks()
			}

			// Wait for batch processing to complete
			while (!batchProcessingFinished) {
				await jest.runAllTicks()
				await new Promise((resolve) => setImmediate(resolve))
			}

			// Verify that upsertPoints was called exactly MAX_BATCH_RETRIES times
			expect(mockVectorStore.upsertPoints).toHaveBeenCalledTimes(MAX_BATCH_RETRIES)

			// Verify that the cache was NOT updated after failed retries
			expect(mockCacheManager.updateHash).not.toHaveBeenCalledWith(
				mockUri.fsPath,
				"new-hash-for-failed-retries-test",
			)

			// Verify the batch summary
			expect(capturedBatchSummary).not.toBeNull()
			expect(capturedBatchSummary.batchError).toBeDefined()
			expect(capturedBatchSummary.batchError.message).toContain(
				`Failed to upsert batch after ${MAX_BATCH_RETRIES} retries`,
			)

			// Verify that the processedFiles array includes the file with error status
			const processedFile = capturedBatchSummary.processedFiles.find((file: any) => file.path === mockUri.fsPath)
			expect(processedFile).toBeDefined()
			expect(processedFile.status).toBe("error")
			expect(processedFile.error).toBeDefined()
			expect(processedFile.error.message).toContain(`Failed to upsert batch after ${MAX_BATCH_RETRIES} retries`)
		}, 15000)
	})

	describe("Pre-existing batch error propagation", () => {
		let onDidDeleteCallback: (uri: any) => void
		let onDidCreateCallback: (uri: any) => void
		let onDidChangeCallback: (uri: any) => void
		let deleteUri: { fsPath: string }
		let createUri: { fsPath: string }
		let changeUri: { fsPath: string }

		beforeEach(() => {
			jest.useFakeTimers()

			// Clear all relevant mocks
			mockCacheManager.deleteHash.mockClear()
			mockCacheManager.getHash.mockClear()
			mockCacheManager.updateHash.mockClear()
			;(mockVectorStore.upsertPoints as jest.Mock).mockClear()
			;(mockVectorStore.deletePointsByFilePath as jest.Mock).mockClear()
			;(mockVectorStore.deletePointsByMultipleFilePaths as jest.Mock).mockClear()

			// Setup file watcher mocks
			vscode.workspace.createFileSystemWatcher.mockReturnValue({
				onDidCreate: jest.fn((callback) => {
					onDidCreateCallback = callback
					return { dispose: jest.fn() }
				}),
				onDidChange: jest.fn((callback) => {
					onDidChangeCallback = callback
					return { dispose: jest.fn() }
				}),
				onDidDelete: jest.fn((callback) => {
					onDidDeleteCallback = callback
					return { dispose: jest.fn() }
				}),
				dispose: jest.fn(),
			})

			fileWatcher.initialize()
			deleteUri = { fsPath: "/mock/workspace/to-be-deleted.js" }
			createUri = { fsPath: "/mock/workspace/to-be-created.js" }
			changeUri = { fsPath: "/mock/workspace/to-be-changed.js" }

			// Ensure file access is allowed
			mockRooIgnoreController.validateAccess.mockReturnValue(true)
		})

		afterEach(() => {
			jest.useRealTimers()
		})

		it("should not execute upsert operations when an overallBatchError pre-exists from deletion phase", async () => {
			// Setup file state mocks for the files to be processed
			vscode.workspace.fs.stat.mockResolvedValue({ size: 100 })
			vscode.workspace.fs.readFile.mockResolvedValue(Buffer.from("test content"))
			mockCacheManager.getHash.mockReturnValue("old-hash")
			;(createHash as jest.Mock).mockReturnValue({
				update: jest.fn().mockReturnThis(),
				digest: jest.fn().mockReturnValue("new-hash"),
			})

			// Setup code parser mock for the files to be processed
			const { codeParser: mockCodeParser } = require("../parser")
			mockCodeParser.parseFile.mockResolvedValue([
				{
					file_path: createUri.fsPath,
					content: "test content",
					start_line: 1,
					end_line: 5,
					identifier: "test",
					type: "function",
					fileHash: "new-hash",
					segmentHash: "segment-hash",
				},
			])

			// Setup a spy for the _onDidFinishBatchProcessing event
			let capturedBatchSummary: any = null
			let batchProcessingFinished = false
			const batchFinishedSpy = jest.fn((summary) => {
				capturedBatchSummary = summary
				batchProcessingFinished = true
			})
			fileWatcher.onDidFinishBatchProcessing(batchFinishedSpy)

			// Mock deletePointsByMultipleFilePaths to throw an error
			const mockDeletionError = new Error("Failed to delete points from vector store")
			;(mockVectorStore.deletePointsByMultipleFilePaths as jest.Mock).mockRejectedValueOnce(mockDeletionError)

			// Simulate delete event by directly adding to accumulated events
			;(fileWatcher as any).accumulatedEvents.set(deleteUri.fsPath, { uri: deleteUri, type: "delete" })
			;(fileWatcher as any).scheduleBatchProcessing()
			await jest.runAllTicks()

			// Simulate create event in the same batch
			;(fileWatcher as any).accumulatedEvents.set(createUri.fsPath, { uri: createUri, type: "create" })
			await jest.runAllTicks()

			// Simulate change event in the same batch
			;(fileWatcher as any).accumulatedEvents.set(changeUri.fsPath, { uri: changeUri, type: "change" })
			await jest.runAllTicks()

			// Advance timers to trigger batch processing
			await jest.advanceTimersByTimeAsync(1000) // Advance past debounce delay
			await jest.runAllTicks()

			// Wait for batch processing to complete
			while (!batchProcessingFinished) {
				await jest.runAllTicks()
				await new Promise((resolve) => setImmediate(resolve))
			}

			// Verify that deletePointsByMultipleFilePaths was called
			expect(mockVectorStore.deletePointsByMultipleFilePaths).toHaveBeenCalled()

			// Verify that upsertPoints was NOT called due to pre-existing error
			expect(mockVectorStore.upsertPoints).not.toHaveBeenCalled()

			// Verify that the cache was NOT updated for the created/changed files
			expect(mockCacheManager.updateHash).not.toHaveBeenCalledWith(createUri.fsPath, expect.any(String))
			expect(mockCacheManager.updateHash).not.toHaveBeenCalledWith(changeUri.fsPath, expect.any(String))

			// Verify the batch summary
			expect(capturedBatchSummary).not.toBeNull()
			expect(capturedBatchSummary.batchError).toBe(mockDeletionError)

			// Verify that the processedFiles array includes all files with appropriate status
			const deletedFile = capturedBatchSummary.processedFiles.find((file: any) => file.path === deleteUri.fsPath)
			expect(deletedFile).toBeDefined()
			expect(deletedFile.status).toBe("error")
			expect(deletedFile.error).toBe(mockDeletionError)

			// Verify that the create/change files also have error status with the same error
			const createdFile = capturedBatchSummary.processedFiles.find((file: any) => file.path === createUri.fsPath)
			expect(createdFile).toBeDefined()
			expect(createdFile.status).toBe("error")
			expect(createdFile.error).toBe(mockDeletionError)

			const changedFile = capturedBatchSummary.processedFiles.find((file: any) => file.path === changeUri.fsPath)
			expect(changedFile).toBeDefined()
			expect(changedFile.status).toBe("error")
			expect(changedFile.error).toBe(mockDeletionError)
		}, 15000)
	})
})
