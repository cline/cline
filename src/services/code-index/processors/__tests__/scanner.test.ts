// @ts-nocheck
import { DirectoryScanner } from "../scanner"
import { stat } from "fs/promises"
import { IEmbedder, IVectorStore, CodeBlock } from "../../../../core/interfaces"
jest.mock("fs/promises", () => ({
	stat: jest.fn(),
}))

// Create a simple mock for vscode since we can't access the real one
jest.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		],
		getWorkspaceFolder: jest.fn().mockReturnValue({
			uri: {
				fsPath: "/mock/workspace",
			},
		}),
		fs: {
			readFile: jest.fn().mockResolvedValue(Buffer.from("test content")),
		},
	},
	Uri: {
		file: jest.fn().mockImplementation((path) => path),
	},
	window: {
		activeTextEditor: {
			document: {
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		},
	},
}))

jest.mock("fs/promises")
jest.mock("../../../glob/list-files")
jest.mock("../../../../core/ignore/RooIgnoreController")
jest.mock("ignore")

describe("DirectoryScanner", () => {
	let scanner: DirectoryScanner
	let mockEmbedder: IEmbedder
	let mockVectorStore: IVectorStore
	let mockCodeParser: ICodeParser
	let mockCacheManager: CacheManager
	let mockIgnoreInstance: any

	beforeEach(() => {
		mockEmbedder = {
			createEmbeddings: jest.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
			embedderInfo: { name: "mock-embedder", dimensions: 384 },
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
		mockCodeParser = {
			parseFile: jest.fn().mockResolvedValue([]),
		}
		mockCacheManager = {
			getHash: jest.fn().mockReturnValue(undefined),
			getAllHashes: jest.fn().mockReturnValue({}),
			updateHash: jest.fn().mockResolvedValue(undefined),
			deleteHash: jest.fn().mockResolvedValue(undefined),
			initialize: jest.fn().mockResolvedValue(undefined),
			clearCacheFile: jest.fn().mockResolvedValue(undefined),
		}
		mockIgnoreInstance = {
			ignores: jest.fn().mockReturnValue(false),
		}

		scanner = new DirectoryScanner(
			mockEmbedder,
			mockVectorStore,
			mockCodeParser,
			mockCacheManager,
			mockIgnoreInstance,
		)

		// Mock default implementations
		;(stat as unknown as jest.Mock).mockResolvedValue({ size: 1024 })
		require("../../../glob/list-files").listFiles.mockResolvedValue([["test/file1.js", "test/file2.js"], []])
	})

	describe("scanDirectory", () => {
		it("should skip files larger than MAX_FILE_SIZE_BYTES", async () => {
			require("../../../glob/list-files").listFiles.mockResolvedValue([["test/file1.js"], []])
			;(stat as jest.Mock).mockResolvedValueOnce({ size: 2 * 1024 * 1024 }) // 2MB > 1MB limit

			const result = await scanner.scanDirectory("/test")
			expect(result.stats.skipped).toBe(1)
			expect(mockCodeParser.parseFile).not.toHaveBeenCalled()
		})

		it("should parse changed files and return code blocks", async () => {
			require("../../../glob/list-files").listFiles.mockResolvedValue([["test/file1.js"], []])
			const mockBlocks: CodeBlock[] = [
				{
					file_path: "test/file1.js",
					content: "test content",
					start_line: 1,
					end_line: 5,
					identifier: "test",
					type: "function",
					fileHash: "hash",
					segmentHash: "segment-hash",
				},
			]
			;(mockCodeParser.parseFile as jest.Mock).mockResolvedValue(mockBlocks)

			const result = await scanner.scanDirectory("/test")
			expect(result.codeBlocks).toEqual(mockBlocks)
			expect(result.stats.processed).toBe(1)
		})

		it("should process embeddings for new/changed files", async () => {
			const mockBlocks: CodeBlock[] = [
				{
					file_path: "test/file1.js",
					content: "test content",
					start_line: 1,
					end_line: 5,
					identifier: "test",
					type: "function",
					fileHash: "hash",
					segmentHash: "segment-hash",
				},
			]
			;(mockCodeParser.parseFile as jest.Mock).mockResolvedValue(mockBlocks)

			await scanner.scanDirectory("/test")
			expect(mockEmbedder.createEmbeddings).toHaveBeenCalled()
			expect(mockVectorStore.upsertPoints).toHaveBeenCalled()
		})

		it("should delete points for removed files", async () => {
			;(mockCacheManager.getAllHashes as jest.Mock).mockReturnValue({ "old/file.js": "old-hash" })

			await scanner.scanDirectory("/test")
			expect(mockVectorStore.deletePointsByFilePath).toHaveBeenCalledWith("old/file.js")
			expect(mockCacheManager.deleteHash).toHaveBeenCalledWith("old/file.js")
		})
	})
})
