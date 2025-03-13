import { loadRuleFiles, addCustomInstructions } from "../custom-instructions"
import fs from "fs/promises"

// Mock fs/promises
jest.mock("fs/promises")
const mockedFs = jest.mocked(fs)

describe("loadRuleFiles", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should read and trim file content", async () => {
		mockedFs.readFile.mockResolvedValue("  content with spaces  ")
		const result = await loadRuleFiles("/fake/path")
		expect(mockedFs.readFile).toHaveBeenCalled()
		expect(result).toBe(
			"\n# Rules from .clinerules:\ncontent with spaces\n" +
				"\n# Rules from .cursorrules:\ncontent with spaces\n" +
				"\n# Rules from .windsurfrules:\ncontent with spaces\n",
		)
	})

	it("should handle ENOENT error", async () => {
		mockedFs.readFile.mockRejectedValue({ code: "ENOENT" })
		const result = await loadRuleFiles("/fake/path")
		expect(result).toBe("")
	})

	it("should handle EISDIR error", async () => {
		mockedFs.readFile.mockRejectedValue({ code: "EISDIR" })
		const result = await loadRuleFiles("/fake/path")
		expect(result).toBe("")
	})

	it("should throw on unexpected errors", async () => {
		const error = new Error("Permission denied") as NodeJS.ErrnoException
		error.code = "EPERM"
		mockedFs.readFile.mockRejectedValue(error)

		await expect(async () => {
			await loadRuleFiles("/fake/path")
		}).rejects.toThrow()
	})
})

describe("loadRuleFiles", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should combine content from multiple rule files when they exist", async () => {
		mockedFs.readFile.mockImplementation(((filePath: string | Buffer | URL | number) => {
			if (filePath.toString().endsWith(".clinerules")) {
				return Promise.resolve("cline rules content")
			}
			if (filePath.toString().endsWith(".cursorrules")) {
				return Promise.resolve("cursor rules content")
			}
			return Promise.reject({ code: "ENOENT" })
		}) as any)

		const result = await loadRuleFiles("/fake/path")
		expect(result).toBe(
			"\n# Rules from .clinerules:\ncline rules content\n" +
				"\n# Rules from .cursorrules:\ncursor rules content\n",
		)
	})

	it("should handle when no rule files exist", async () => {
		mockedFs.readFile.mockRejectedValue({ code: "ENOENT" })

		const result = await loadRuleFiles("/fake/path")
		expect(result).toBe("")
	})

	it("should throw on unexpected errors", async () => {
		const error = new Error("Permission denied") as NodeJS.ErrnoException
		error.code = "EPERM"
		mockedFs.readFile.mockRejectedValue(error)

		await expect(async () => {
			await loadRuleFiles("/fake/path")
		}).rejects.toThrow()
	})

	it("should skip directories with same name as rule files", async () => {
		mockedFs.readFile.mockImplementation(((filePath: string | Buffer | URL | number) => {
			if (filePath.toString().endsWith(".clinerules")) {
				return Promise.reject({ code: "EISDIR" })
			}
			if (filePath.toString().endsWith(".cursorrules")) {
				return Promise.resolve("cursor rules content")
			}
			return Promise.reject({ code: "ENOENT" })
		}) as any)

		const result = await loadRuleFiles("/fake/path")
		expect(result).toBe("\n# Rules from .cursorrules:\ncursor rules content\n")
	})
})

describe("addCustomInstructions", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should combine all instruction types when provided", async () => {
		mockedFs.readFile.mockResolvedValue("mode specific rules")

		const result = await addCustomInstructions(
			"mode instructions",
			"global instructions",
			"/fake/path",
			"test-mode",
			{ language: "es" },
		)

		expect(result).toContain("Language Preference:")
		expect(result).toContain("es")
		expect(result).toContain("Global Instructions:\nglobal instructions")
		expect(result).toContain("Mode-specific Instructions:\nmode instructions")
		expect(result).toContain("Rules from .clinerules-test-mode:\nmode specific rules")
	})

	it("should return empty string when no instructions provided", async () => {
		mockedFs.readFile.mockRejectedValue({ code: "ENOENT" })

		const result = await addCustomInstructions("", "", "/fake/path", "", {})
		expect(result).toBe("")
	})

	it("should handle missing mode-specific rules file", async () => {
		mockedFs.readFile.mockRejectedValue({ code: "ENOENT" })

		const result = await addCustomInstructions(
			"mode instructions",
			"global instructions",
			"/fake/path",
			"test-mode",
		)

		expect(result).toContain("Global Instructions:")
		expect(result).toContain("Mode-specific Instructions:")
		expect(result).not.toContain("Rules from .clinerules-test-mode")
	})

	it("should throw on unexpected errors", async () => {
		const error = new Error("Permission denied") as NodeJS.ErrnoException
		error.code = "EPERM"
		mockedFs.readFile.mockRejectedValue(error)

		await expect(async () => {
			await addCustomInstructions("", "", "/fake/path", "test-mode")
		}).rejects.toThrow()
	})

	it("should skip mode-specific rule files that are directories", async () => {
		mockedFs.readFile.mockImplementation(((filePath: string | Buffer | URL | number) => {
			if (filePath.toString().includes(".clinerules-test-mode")) {
				return Promise.reject({ code: "EISDIR" })
			}
			return Promise.reject({ code: "ENOENT" })
		}) as any)

		const result = await addCustomInstructions(
			"mode instructions",
			"global instructions",
			"/fake/path",
			"test-mode",
		)

		expect(result).toContain("Global Instructions:\nglobal instructions")
		expect(result).toContain("Mode-specific Instructions:\nmode instructions")
		expect(result).not.toContain("Rules from .clinerules-test-mode")
	})
})
