import * as path from "path"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// Use vi.hoisted to ensure mocks are available during hoisting
const { mockHomedir, mockStat, mockReadFile, mockReaddir, mockGetRooDirectoriesForCwd, mockGetGlobalRooDirectory } =
	vi.hoisted(() => ({
		mockHomedir: vi.fn(),
		mockStat: vi.fn(),
		mockReadFile: vi.fn(),
		mockReaddir: vi.fn(),
		mockGetRooDirectoriesForCwd: vi.fn(),
		mockGetGlobalRooDirectory: vi.fn(),
	}))

// Mock os module
vi.mock("os", () => ({
	default: {
		homedir: mockHomedir,
	},
	homedir: mockHomedir,
}))

// Mock fs/promises
vi.mock("fs/promises", () => ({
	default: {
		stat: mockStat,
		readFile: mockReadFile,
		readdir: mockReaddir,
	},
}))

// Mock the roo-config service
vi.mock("../../../../services/roo-config", () => ({
	getRooDirectoriesForCwd: mockGetRooDirectoriesForCwd,
	getGlobalRooDirectory: mockGetGlobalRooDirectory,
}))

import { loadRuleFiles, addCustomInstructions } from "../custom-instructions"

describe("custom-instructions global .roo support", () => {
	const mockCwd = "/mock/project"
	const mockHomeDir = "/mock/home"
	const globalRooDir = path.join(mockHomeDir, ".roo")
	const projectRooDir = path.join(mockCwd, ".roo")

	beforeEach(() => {
		vi.clearAllMocks()
		mockHomedir.mockReturnValue(mockHomeDir)
		mockGetRooDirectoriesForCwd.mockReturnValue([globalRooDir, projectRooDir])
		mockGetGlobalRooDirectory.mockReturnValue(globalRooDir)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("loadRuleFiles", () => {
		it("should load global rules only when project rules do not exist", async () => {
			// Mock directory existence checks in order:
			// 1. Check if global rules dir exists
			// 2. Check if project rules dir doesn't exist
			mockStat
				.mockResolvedValueOnce({ isDirectory: () => true } as any) // global rules dir exists
				.mockResolvedValueOnce({ isFile: () => true } as any) // for the file check inside readTextFilesFromDirectory
				.mockRejectedValueOnce(new Error("ENOENT")) // project rules dir doesn't exist

			// Mock directory reading for global rules
			mockReaddir.mockResolvedValueOnce([
				{ name: "rules.md", isFile: () => true, isSymbolicLink: () => false } as any,
			])

			// Mock file reading for the rules.md file
			mockReadFile.mockResolvedValueOnce("global rule content")

			const result = await loadRuleFiles(mockCwd)

			expect(result).toContain("# Rules from")
			expect(result).toContain("rules.md:")
			expect(result).toContain("global rule content")
			expect(result).not.toContain("project rule content")
		})

		it("should load project rules only when global rules do not exist", async () => {
			// Mock directory existence
			mockStat
				.mockRejectedValueOnce(new Error("ENOENT")) // global rules dir doesn't exist
				.mockResolvedValueOnce({ isDirectory: () => true } as any) // project rules dir exists

			// Mock directory reading for project rules
			mockReaddir.mockResolvedValueOnce([
				{ name: "rules.md", isFile: () => true, isSymbolicLink: () => false } as any,
			])

			// Mock file reading
			mockStat.mockResolvedValueOnce({ isFile: () => true } as any) // for the file check
			mockReadFile.mockResolvedValueOnce("project rule content")

			const result = await loadRuleFiles(mockCwd)

			expect(result).toContain("# Rules from")
			expect(result).toContain("rules.md:")
			expect(result).toContain("project rule content")
			expect(result).not.toContain("global rule content")
		})

		it("should merge global and project rules with project rules after global", async () => {
			// Mock directory existence - both exist
			mockStat
				.mockResolvedValueOnce({ isDirectory: () => true } as any) // global rules dir exists
				.mockResolvedValueOnce({ isFile: () => true } as any) // global file check
				.mockResolvedValueOnce({ isDirectory: () => true } as any) // project rules dir exists
				.mockResolvedValueOnce({ isFile: () => true } as any) // project file check

			// Mock directory reading
			mockReaddir
				.mockResolvedValueOnce([{ name: "global.md", isFile: () => true, isSymbolicLink: () => false } as any])
				.mockResolvedValueOnce([{ name: "project.md", isFile: () => true, isSymbolicLink: () => false } as any])

			// Mock file reading
			mockReadFile.mockResolvedValueOnce("global rule content").mockResolvedValueOnce("project rule content")

			const result = await loadRuleFiles(mockCwd)

			expect(result).toContain("# Rules from")
			expect(result).toContain("global.md:")
			expect(result).toContain("global rule content")
			expect(result).toContain("project.md:")
			expect(result).toContain("project rule content")

			// Ensure project rules come after global rules
			const globalIndex = result.indexOf("global rule content")
			const projectIndex = result.indexOf("project rule content")
			expect(globalIndex).toBeLessThan(projectIndex)
		})

		it("should fall back to legacy .roorules file when no .roo/rules directories exist", async () => {
			// Mock directory existence - neither exist
			mockStat
				.mockRejectedValueOnce(new Error("ENOENT")) // global rules dir doesn't exist
				.mockRejectedValueOnce(new Error("ENOENT")) // project rules dir doesn't exist

			// Mock legacy file reading
			mockReadFile.mockResolvedValueOnce("legacy rule content")

			const result = await loadRuleFiles(mockCwd)

			expect(result).toContain("# Rules from .roorules:")
			expect(result).toContain("legacy rule content")
		})

		it("should return empty string when no rules exist anywhere", async () => {
			// Mock directory existence - neither exist
			mockStat
				.mockRejectedValueOnce(new Error("ENOENT")) // global rules dir doesn't exist
				.mockRejectedValueOnce(new Error("ENOENT")) // project rules dir doesn't exist

			// Mock legacy file reading - both fail (using safeReadFile which catches errors)
			// The safeReadFile function catches ENOENT errors and returns empty string
			// So we don't need to mock rejections, just empty responses
			mockReadFile
				.mockResolvedValueOnce("") // .roorules returns empty (simulating ENOENT caught by safeReadFile)
				.mockResolvedValueOnce("") // .clinerules returns empty (simulating ENOENT caught by safeReadFile)

			const result = await loadRuleFiles(mockCwd)

			expect(result).toBe("")
		})
	})

	describe("addCustomInstructions mode-specific rules", () => {
		it("should load global and project mode-specific rules", async () => {
			const mode = "code"

			// Mock directory existence for mode-specific rules
			mockStat
				.mockResolvedValueOnce({ isDirectory: () => true } as any) // global rules-code dir exists
				.mockResolvedValueOnce({ isFile: () => true } as any) // global mode file check
				.mockResolvedValueOnce({ isDirectory: () => true } as any) // project rules-code dir exists
				.mockResolvedValueOnce({ isFile: () => true } as any) // project mode file check
				.mockRejectedValueOnce(new Error("ENOENT")) // global rules dir doesn't exist (for generic rules)
				.mockRejectedValueOnce(new Error("ENOENT")) // project rules dir doesn't exist (for generic rules)

			// Mock directory reading for mode-specific rules
			mockReaddir
				.mockResolvedValueOnce([
					{ name: "global-mode.md", isFile: () => true, isSymbolicLink: () => false } as any,
				])
				.mockResolvedValueOnce([
					{ name: "project-mode.md", isFile: () => true, isSymbolicLink: () => false } as any,
				])

			// Mock file reading for mode-specific rules
			mockReadFile
				.mockResolvedValueOnce("global mode rule content")
				.mockResolvedValueOnce("project mode rule content")
				.mockResolvedValueOnce("") // .roorules legacy file (empty)
				.mockResolvedValueOnce("") // .clinerules legacy file (empty)

			const result = await addCustomInstructions("", "", mockCwd, mode)

			expect(result).toContain("# Rules from")
			expect(result).toContain("global-mode.md:")
			expect(result).toContain("global mode rule content")
			expect(result).toContain("project-mode.md:")
			expect(result).toContain("project mode rule content")
		})

		it("should fall back to legacy mode-specific files when no mode directories exist", async () => {
			const mode = "code"

			// Mock directory existence - mode-specific dirs don't exist
			mockStat
				.mockRejectedValueOnce(new Error("ENOENT")) // global rules-code dir doesn't exist
				.mockRejectedValueOnce(new Error("ENOENT")) // project rules-code dir doesn't exist
				.mockRejectedValueOnce(new Error("ENOENT")) // global rules dir doesn't exist
				.mockRejectedValueOnce(new Error("ENOENT")) // project rules dir doesn't exist

			// Mock legacy mode file reading
			mockReadFile
				.mockResolvedValueOnce("legacy mode rule content") // .roorules-code
				.mockResolvedValueOnce("") // generic .roorules (empty)
				.mockResolvedValueOnce("") // generic .clinerules (empty)

			const result = await addCustomInstructions("", "", mockCwd, mode)

			expect(result).toContain("# Rules from .roorules-code:")
			expect(result).toContain("legacy mode rule content")
		})
	})
})
