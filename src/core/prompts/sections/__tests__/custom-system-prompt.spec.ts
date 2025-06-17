// Mocks must come first, before imports

vi.mock("fs/promises")

// Then imports
import type { Mock } from "vitest"
import path from "path"
import { readFile } from "fs/promises"
import type { Mode } from "../../../../shared/modes" // Type-only import
import { loadSystemPromptFile, PromptVariables } from "../custom-system-prompt"

// Cast the mocked readFile to the correct Mock type
const mockedReadFile = readFile as Mock<typeof readFile>

describe("loadSystemPromptFile", () => {
	// Corrected PromptVariables type and added mockMode
	const mockVariables: PromptVariables = {
		workspace: "/path/to/workspace",
	}
	const mockCwd = "/mock/cwd"
	const mockMode: Mode = "test" // Use Mode type, e.g., 'test'
	// Corrected expected file path format
	const expectedFilePath = path.join(mockCwd, ".roo", `system-prompt-${mockMode}`)

	beforeEach(() => {
		// Clear mocks before each test
		mockedReadFile.mockClear()
	})

	it("should return an empty string if the file does not exist (ENOENT)", async () => {
		const error: NodeJS.ErrnoException = new Error("File not found")
		error.code = "ENOENT"
		mockedReadFile.mockRejectedValue(error)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedFilePath, "utf-8")
	})

	// Updated test: should re-throw unexpected errors
	it("should re-throw unexpected errors from readFile", async () => {
		const expectedError = new Error("Some other error")
		mockedReadFile.mockRejectedValue(expectedError)

		// Assert that the promise rejects with the specific error
		await expect(loadSystemPromptFile(mockCwd, mockMode, mockVariables)).rejects.toThrow(expectedError)

		// Verify readFile was still called correctly
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedFilePath, "utf-8")
	})

	it("should return an empty string if the file content is empty", async () => {
		mockedReadFile.mockResolvedValue("")

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedFilePath, "utf-8")
	})

	// Updated test to only check workspace interpolation
	it("should correctly interpolate workspace variable", async () => {
		const template = "Workspace is: {{workspace}}"
		mockedReadFile.mockResolvedValue(template)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("Workspace is: /path/to/workspace")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedFilePath, "utf-8")
	})

	// Updated test for multiple occurrences of workspace
	it("should handle multiple occurrences of the workspace variable", async () => {
		const template = "Path: {{workspace}}/{{workspace}}"
		mockedReadFile.mockResolvedValue(template)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("Path: /path/to/workspace//path/to/workspace")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedFilePath, "utf-8")
	})

	// Updated test for mixed used/unused
	it("should handle mixed used workspace and unused variables", async () => {
		const template = "Workspace: {{workspace}}, Unused: {{unusedVar}}, Another: {{another}}"
		mockedReadFile.mockResolvedValue(template)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		// Unused variables should remain untouched
		expect(result).toBe("Workspace: /path/to/workspace, Unused: {{unusedVar}}, Another: {{another}}")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedFilePath, "utf-8")
	})

	// Test remains valid, just needs the mode argument and updated template
	it("should handle templates with placeholders not present in variables", async () => {
		const template = "Workspace: {{workspace}}, Missing: {{missingPlaceholder}}"
		mockedReadFile.mockResolvedValue(template)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("Workspace: /path/to/workspace, Missing: {{missingPlaceholder}}")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedFilePath, "utf-8")
	})

	// Removed the test for extra keys as PromptVariables is simple now

	// Test remains valid, just needs the mode argument
	it("should handle template with no variables", async () => {
		const template = "This is a static prompt."
		mockedReadFile.mockResolvedValue(template)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("This is a static prompt.")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedFilePath, "utf-8")
	})
})
