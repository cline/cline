import type { Mock } from "vitest"
import * as vscode from "vscode"
import { createHash } from "crypto"
import debounce from "lodash.debounce"
import { CacheManager } from "../cache-manager"

// Mock safeWriteJson utility
vitest.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vitest.fn().mockResolvedValue(undefined),
}))

// Import the mocked version
import { safeWriteJson } from "../../../utils/safeWriteJson"

// Mock vscode
vitest.mock("vscode", () => ({
	Uri: {
		joinPath: vitest.fn(),
	},
	workspace: {
		fs: {
			readFile: vitest.fn(),
			writeFile: vitest.fn(),
			delete: vitest.fn(),
		},
	},
}))

// Mock debounce to execute immediately
vitest.mock("lodash.debounce", () => ({ default: vitest.fn((fn) => fn) }))

describe("CacheManager", () => {
	let mockContext: vscode.ExtensionContext
	let mockWorkspacePath: string
	let mockCachePath: vscode.Uri
	let cacheManager: CacheManager

	beforeEach(() => {
		// Reset all mocks
		vitest.clearAllMocks()

		// Mock context
		mockWorkspacePath = "/mock/workspace"
		mockCachePath = { fsPath: "/mock/storage/cache.json" } as vscode.Uri
		mockContext = {
			globalStorageUri: { fsPath: "/mock/storage" } as vscode.Uri,
		} as vscode.ExtensionContext

		// Mock Uri.joinPath
		;(vscode.Uri.joinPath as Mock).mockReturnValue(mockCachePath)

		// Create cache manager instance
		cacheManager = new CacheManager(mockContext, mockWorkspacePath)
	})

	describe("constructor", () => {
		it("should correctly set up cachePath using Uri.joinPath and crypto.createHash", () => {
			const expectedHash = createHash("sha256").update(mockWorkspacePath).digest("hex")

			expect(vscode.Uri.joinPath).toHaveBeenCalledWith(
				mockContext.globalStorageUri,
				`roo-index-cache-${expectedHash}.json`,
			)
		})

		it("should set up debounced save function", () => {
			expect(debounce).toHaveBeenCalledWith(expect.any(Function), 1500)
		})
	})

	describe("initialize", () => {
		it("should load existing cache file successfully", async () => {
			const mockCache = { "file1.ts": "hash1", "file2.ts": "hash2" }
			const mockBuffer = Buffer.from(JSON.stringify(mockCache))
			;(vscode.workspace.fs.readFile as Mock).mockResolvedValue(mockBuffer)

			await cacheManager.initialize()

			expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(mockCachePath)
			expect(cacheManager.getAllHashes()).toEqual(mockCache)
		})

		it("should handle missing cache file by creating empty cache", async () => {
			;(vscode.workspace.fs.readFile as Mock).mockRejectedValue(new Error("File not found"))

			await cacheManager.initialize()

			expect(cacheManager.getAllHashes()).toEqual({})
		})
	})

	describe("hash management", () => {
		it("should update hash and trigger save", () => {
			const filePath = "test.ts"
			const hash = "testhash"

			cacheManager.updateHash(filePath, hash)

			expect(cacheManager.getHash(filePath)).toBe(hash)
			expect(safeWriteJson).toHaveBeenCalled()
		})

		it("should delete hash and trigger save", () => {
			const filePath = "test.ts"
			const hash = "testhash"

			cacheManager.updateHash(filePath, hash)
			cacheManager.deleteHash(filePath)

			expect(cacheManager.getHash(filePath)).toBeUndefined()
			expect(safeWriteJson).toHaveBeenCalled()
		})

		it("should return shallow copy of hashes", () => {
			const filePath = "test.ts"
			const hash = "testhash"

			cacheManager.updateHash(filePath, hash)
			const hashes = cacheManager.getAllHashes()

			// Modify the returned object
			hashes[filePath] = "modified"

			// Original should remain unchanged
			expect(cacheManager.getHash(filePath)).toBe(hash)
		})
	})

	describe("saving", () => {
		it("should save cache to disk with correct data", async () => {
			const filePath = "test.ts"
			const hash = "testhash"

			cacheManager.updateHash(filePath, hash)

			expect(safeWriteJson).toHaveBeenCalledWith(mockCachePath.fsPath, expect.any(Object))

			// Verify the saved data
			const savedData = (safeWriteJson as Mock).mock.calls[0][1]
			expect(savedData).toEqual({ [filePath]: hash })
		})

		it("should handle save errors gracefully", async () => {
			const consoleErrorSpy = vitest.spyOn(console, "error").mockImplementation(() => {})
			;(safeWriteJson as Mock).mockRejectedValue(new Error("Save failed"))

			cacheManager.updateHash("test.ts", "hash")

			// Wait for any pending promises
			await new Promise((resolve) => setTimeout(resolve, 0))

			expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to save cache:", expect.any(Error))

			consoleErrorSpy.mockRestore()
		})
	})

	describe("clearCacheFile", () => {
		it("should clear cache file and reset state", async () => {
			cacheManager.updateHash("test.ts", "hash")

			// Reset the mock to ensure safeWriteJson succeeds for clearCacheFile
			;(safeWriteJson as Mock).mockClear()
			;(safeWriteJson as Mock).mockResolvedValue(undefined)

			await cacheManager.clearCacheFile()

			expect(safeWriteJson).toHaveBeenCalledWith(mockCachePath.fsPath, {})
			expect(cacheManager.getAllHashes()).toEqual({})
		})

		it("should handle clear errors gracefully", async () => {
			const consoleErrorSpy = vitest.spyOn(console, "error").mockImplementation(() => {})
			;(safeWriteJson as Mock).mockRejectedValue(new Error("Save failed"))

			await cacheManager.clearCacheFile()

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				"Failed to clear cache file:",
				expect.any(Error),
				mockCachePath,
			)

			consoleErrorSpy.mockRestore()
		})
	})
})
