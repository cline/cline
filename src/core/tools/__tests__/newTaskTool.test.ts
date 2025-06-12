import { jest } from "@jest/globals"
import type { AskApproval, HandleError } from "../../../shared/tools" // Import the types

// Mock dependencies before importing the module under test
// Explicitly type the mock functions
const mockAskApproval = jest.fn<AskApproval>()
const mockHandleError = jest.fn<HandleError>() // Explicitly type HandleError
const mockPushToolResult = jest.fn()
const mockRemoveClosingTag = jest.fn((_name: string, value: string | undefined) => value ?? "") // Simple mock
const mockGetModeBySlug = jest.fn()
// Define a minimal type for the resolved value
type MockClineInstance = { taskId: string }
// Make initClineWithTask return a mock Cline-like object with taskId, providing type hint
const mockInitClineWithTask = jest
	.fn<() => Promise<MockClineInstance>>()
	.mockResolvedValue({ taskId: "mock-subtask-id" })
const mockEmit = jest.fn()
const mockRecordToolError = jest.fn()
const mockSayAndCreateMissingParamError = jest.fn()

// Mock the Cline instance and its methods/properties
const mockCline = {
	ask: jest.fn(),
	sayAndCreateMissingParamError: mockSayAndCreateMissingParamError,
	emit: mockEmit,
	recordToolError: mockRecordToolError,
	consecutiveMistakeCount: 0,
	isPaused: false,
	pausedModeSlug: "ask", // Default or mock value
	providerRef: {
		deref: jest.fn(() => ({
			getState: jest.fn(() => ({ customModes: [], mode: "ask" })), // Mock provider state
			handleModeSwitch: jest.fn(),
			initClineWithTask: mockInitClineWithTask,
		})),
	},
}

// Mock other modules
jest.mock("delay", () => jest.fn(() => Promise.resolve())) // Mock delay to resolve immediately
jest.mock("../../../shared/modes", () => ({
	// Corrected path
	getModeBySlug: mockGetModeBySlug,
	defaultModeSlug: "ask",
}))
jest.mock("../../prompts/responses", () => ({
	// Corrected path
	formatResponse: {
		toolError: jest.fn((msg: string) => `Tool Error: ${msg}`), // Simple mock
	},
}))

// Import the function to test AFTER mocks are set up
import { newTaskTool } from "../newTaskTool"
import type { ToolUse } from "../../../shared/tools"

describe("newTaskTool", () => {
	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks()
		mockAskApproval.mockResolvedValue(true) // Default to approved
		mockGetModeBySlug.mockReturnValue({ slug: "code", name: "Code Mode" }) // Default valid mode
		mockCline.consecutiveMistakeCount = 0
		mockCline.isPaused = false
	})

	it("should correctly un-escape \\\\@ to \\@ in the message passed to the new task", async () => {
		const block: ToolUse = {
			type: "tool_use", // Add required 'type' property
			name: "new_task", // Correct property name
			params: {
				mode: "code",
				message: "Review this: \\\\@file1.txt and also \\\\\\\\@file2.txt", // Input with \\@ and \\\\@
			},
			partial: false,
		}

		await newTaskTool(
			mockCline as any, // Use 'as any' for simplicity in mocking complex type
			block,
			mockAskApproval, // Now correctly typed
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify askApproval was called
		expect(mockAskApproval).toHaveBeenCalled()

		// Verify the message passed to initClineWithTask reflects the code's behavior in unit tests
		expect(mockInitClineWithTask).toHaveBeenCalledWith(
			"Review this: \\@file1.txt and also \\\\\\@file2.txt", // Unit Test Expectation: \\@ -> \@, \\\\@ -> \\\\@
			undefined,
			mockCline,
		)

		// Verify side effects
		expect(mockCline.emit).toHaveBeenCalledWith("taskSpawned", expect.any(String)) // Assuming initCline returns a mock task ID
		expect(mockCline.isPaused).toBe(true)
		expect(mockCline.emit).toHaveBeenCalledWith("taskPaused")
		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Successfully created new task"))
	})

	it("should not un-escape single escaped \@", async () => {
		const block: ToolUse = {
			type: "tool_use", // Add required 'type' property
			name: "new_task", // Correct property name
			params: {
				mode: "code",
				message: "This is already unescaped: \\@file1.txt",
			},
			partial: false,
		}

		await newTaskTool(
			mockCline as any,
			block,
			mockAskApproval, // Now correctly typed
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockInitClineWithTask).toHaveBeenCalledWith(
			"This is already unescaped: \\@file1.txt", // Expected: \@ remains \@
			undefined,
			mockCline,
		)
	})

	it("should not un-escape non-escaped @", async () => {
		const block: ToolUse = {
			type: "tool_use", // Add required 'type' property
			name: "new_task", // Correct property name
			params: {
				mode: "code",
				message: "A normal mention @file1.txt",
			},
			partial: false,
		}

		await newTaskTool(
			mockCline as any,
			block,
			mockAskApproval, // Now correctly typed
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockInitClineWithTask).toHaveBeenCalledWith(
			"A normal mention @file1.txt", // Expected: @ remains @
			undefined,
			mockCline,
		)
	})

	it("should handle mixed escaping scenarios", async () => {
		const block: ToolUse = {
			type: "tool_use", // Add required 'type' property
			name: "new_task", // Correct property name
			params: {
				mode: "code",
				message: "Mix: @file0.txt, \\@file1.txt, \\\\@file2.txt, \\\\\\\\@file3.txt",
			},
			partial: false,
		}

		await newTaskTool(
			mockCline as any,
			block,
			mockAskApproval, // Now correctly typed
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockInitClineWithTask).toHaveBeenCalledWith(
			"Mix: @file0.txt, \\@file1.txt, \\@file2.txt, \\\\\\@file3.txt", // Unit Test Expectation: @->@, \@->\@, \\@->\@, \\\\@->\\\\@
			undefined,
			mockCline,
		)
	})

	// Add more tests for error handling (missing params, invalid mode, approval denied) if needed
})
