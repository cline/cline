import { SYSTEM_PROMPT } from "../system"
import { defaultModeSlug, modes } from "../../../shared/modes"
import * as vscode from "vscode"
import * as fs from "fs/promises"

// Mock the fs/promises module
jest.mock("fs/promises", () => ({
	readFile: jest.fn(),
	mkdir: jest.fn().mockResolvedValue(undefined),
	access: jest.fn().mockResolvedValue(undefined),
}))

// Get the mocked fs module
const mockedFs = fs as jest.Mocked<typeof fs>

// Mock the fileExistsAtPath function
jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockResolvedValue(true),
	createDirectoriesForFile: jest.fn().mockResolvedValue([]),
}))

// Create a mock ExtensionContext with relative paths instead of absolute paths
const mockContext = {
	extensionPath: "mock/extension/path",
	globalStoragePath: "mock/storage/path",
	storagePath: "mock/storage/path",
	logPath: "mock/log/path",
	subscriptions: [],
	workspaceState: {
		get: () => undefined,
		update: () => Promise.resolve(),
	},
	globalState: {
		get: () => undefined,
		update: () => Promise.resolve(),
		setKeysForSync: () => {},
	},
	extensionUri: { fsPath: "mock/extension/path" },
	globalStorageUri: { fsPath: "mock/settings/path" },
	asAbsolutePath: (relativePath: string) => `mock/extension/path/${relativePath}`,
	extension: {
		packageJSON: {
			version: "1.0.0",
		},
	},
} as unknown as vscode.ExtensionContext

describe("File-Based Custom System Prompt", () => {
	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks()

		// Default behavior: file doesn't exist
		mockedFs.readFile.mockRejectedValue({ code: "ENOENT" })
	})

	it("should use default generation when no file-based system prompt is found", async () => {
		const customModePrompts = {
			[defaultModeSlug]: {
				roleDefinition: "Test role definition",
			},
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"test/path", // Using a relative path without leading slash
			false, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			customModePrompts, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			true, // enableMcpServerCreation
		)

		// Should contain default sections
		expect(prompt).toContain("TOOL USE")
		expect(prompt).toContain("CAPABILITIES")
		expect(prompt).toContain("MODES")
		expect(prompt).toContain("Test role definition")
	})

	it("should use file-based custom system prompt when available", async () => {
		// Mock the readFile to return content from a file
		const fileCustomSystemPrompt = "Custom system prompt from file"
		// When called with utf-8 encoding, return a string
		mockedFs.readFile.mockImplementation((filePath, options) => {
			if (filePath.toString().includes(`.roo/system-prompt-${defaultModeSlug}`) && options === "utf-8") {
				return Promise.resolve(fileCustomSystemPrompt)
			}
			return Promise.reject({ code: "ENOENT" })
		})

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"test/path", // Using a relative path without leading slash
			false, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			true, // enableMcpServerCreation
		)

		// Should contain role definition and file-based system prompt
		expect(prompt).toContain(modes[0].roleDefinition)
		expect(prompt).toContain(fileCustomSystemPrompt)

		// Should not contain any of the default sections
		expect(prompt).not.toContain("CAPABILITIES")
		expect(prompt).not.toContain("MODES")
	})

	it("should combine file-based system prompt with role definition and custom instructions", async () => {
		// Mock the readFile to return content from a file
		const fileCustomSystemPrompt = "Custom system prompt from file"
		mockedFs.readFile.mockImplementation((filePath, options) => {
			if (filePath.toString().includes(`.roo/system-prompt-${defaultModeSlug}`) && options === "utf-8") {
				return Promise.resolve(fileCustomSystemPrompt)
			}
			return Promise.reject({ code: "ENOENT" })
		})

		// Define custom role definition
		const customRoleDefinition = "Custom role definition"
		const customModePrompts = {
			[defaultModeSlug]: {
				roleDefinition: customRoleDefinition,
			},
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"test/path", // Using a relative path without leading slash
			false, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			customModePrompts, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			true, // enableMcpServerCreation
		)

		// Should contain custom role definition and file-based system prompt
		expect(prompt).toContain(customRoleDefinition)
		expect(prompt).toContain(fileCustomSystemPrompt)

		// Should not contain any of the default sections
		expect(prompt).not.toContain("CAPABILITIES")
		expect(prompt).not.toContain("MODES")
	})
})
