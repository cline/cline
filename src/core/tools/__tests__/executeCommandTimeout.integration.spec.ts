// Integration tests for command execution timeout functionality
// npx vitest run src/core/tools/__tests__/executeCommandTimeout.integration.spec.ts

import * as vscode from "vscode"
import * as fs from "fs/promises"
import { executeCommand, executeCommandTool, ExecuteCommandOptions } from "../executeCommandTool"
import { Task } from "../../task/Task"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"

// Mock dependencies
vitest.mock("vscode", () => ({
	workspace: {
		getConfiguration: vitest.fn(),
	},
}))

vitest.mock("fs/promises")
vitest.mock("../../../integrations/terminal/TerminalRegistry")
vitest.mock("../../task/Task")
vitest.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vitest.fn((msg) => `Tool Error: ${msg}`),
		rooIgnoreError: vitest.fn((msg) => `RooIgnore Error: ${msg}`),
	},
}))
vitest.mock("../../../utils/text-normalization", () => ({
	unescapeHtmlEntities: vitest.fn((text) => text),
}))
vitest.mock("../../../shared/package", () => ({
	Package: {
		name: "roo-cline",
	},
}))

describe("Command Execution Timeout Integration", () => {
	let mockTask: any
	let mockTerminal: any
	let mockProcess: any

	beforeEach(() => {
		vitest.clearAllMocks()

		// Mock fs.access to resolve successfully for working directory
		;(fs.access as any).mockResolvedValue(undefined)

		// Mock task
		mockTask = {
			cwd: "/test/directory",
			terminalProcess: undefined,
			providerRef: {
				deref: vitest.fn().mockResolvedValue({
					postMessageToWebview: vitest.fn(),
				}),
			},
			say: vitest.fn().mockResolvedValue(undefined),
		}

		// Mock terminal process
		mockProcess = {
			abort: vitest.fn(),
			then: vitest.fn(),
			catch: vitest.fn(),
		}

		// Mock terminal
		mockTerminal = {
			runCommand: vitest.fn().mockReturnValue(mockProcess),
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/directory"),
		}

		// Mock TerminalRegistry
		;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockTerminal)

		// Mock VSCode configuration
		const mockGetConfiguration = vitest.fn().mockReturnValue({
			get: vitest.fn().mockReturnValue(0), // Default 0 (no timeout)
		})
		;(vscode.workspace.getConfiguration as any).mockReturnValue(mockGetConfiguration())
	})

	it("should pass timeout configuration to executeCommand", async () => {
		const customTimeoutMs = 15000 // 15 seconds in milliseconds
		const options: ExecuteCommandOptions = {
			executionId: "test-execution",
			command: "echo test",
			commandExecutionTimeout: customTimeoutMs,
		}

		// Mock a quick-completing process
		const quickProcess = Promise.resolve()
		mockTerminal.runCommand.mockReturnValue(quickProcess)

		await executeCommand(mockTask as Task, options)

		// Verify that the terminal was called with the command
		expect(mockTerminal.runCommand).toHaveBeenCalledWith("echo test", expect.any(Object))
	})

	it("should handle timeout scenario", async () => {
		const shortTimeoutMs = 100 // Very short timeout in milliseconds
		const options: ExecuteCommandOptions = {
			executionId: "test-execution",
			command: "sleep 10",
			commandExecutionTimeout: shortTimeoutMs,
		}

		// Create a process that never resolves but has an abort method
		const longRunningProcess = new Promise(() => {
			// Never resolves to simulate a hanging command
		})

		// Add abort method to the promise
		;(longRunningProcess as any).abort = vitest.fn()

		mockTerminal.runCommand.mockReturnValue(longRunningProcess)

		// Execute with timeout
		const result = await executeCommand(mockTask as Task, options)

		// Should return timeout error
		expect(result[0]).toBe(false) // Not rejected by user
		expect(result[1]).toContain("terminated after exceeding")
		expect(result[1]).toContain("0.1s") // Should show seconds in error message
	}, 10000) // Increase test timeout to 10 seconds

	it("should abort process on timeout", async () => {
		const shortTimeoutMs = 50 // Short timeout in milliseconds
		const options: ExecuteCommandOptions = {
			executionId: "test-execution",
			command: "sleep 10",
			commandExecutionTimeout: shortTimeoutMs,
		}

		// Create a process that can be aborted
		const abortSpy = vitest.fn()

		// Mock the process to never resolve but be abortable
		const neverResolvingPromise = new Promise(() => {})
		;(neverResolvingPromise as any).abort = abortSpy

		mockTerminal.runCommand.mockReturnValue(neverResolvingPromise)

		await executeCommand(mockTask as Task, options)

		// Verify abort was called
		expect(abortSpy).toHaveBeenCalled()
	}, 5000) // Increase test timeout to 5 seconds

	it("should clean up timeout on successful completion", async () => {
		const options: ExecuteCommandOptions = {
			executionId: "test-execution",
			command: "echo test",
			commandExecutionTimeout: 5000,
		}

		// Mock a process that completes quickly
		const quickProcess = Promise.resolve()
		mockTerminal.runCommand.mockReturnValue(quickProcess)

		const result = await executeCommand(mockTask as Task, options)

		// Should complete successfully without timeout
		expect(result[0]).toBe(false) // Not rejected
		expect(result[1]).not.toContain("terminated after exceeding")
	})

	it("should use default timeout when not specified (0 = no timeout)", async () => {
		const options: ExecuteCommandOptions = {
			executionId: "test-execution",
			command: "echo test",
			// commandExecutionTimeout not specified, should use default (0)
		}

		const quickProcess = Promise.resolve()
		mockTerminal.runCommand.mockReturnValue(quickProcess)

		await executeCommand(mockTask as Task, options)

		// Should complete without issues using default (no timeout)
		expect(mockTerminal.runCommand).toHaveBeenCalled()
	})

	it("should not timeout when commandExecutionTimeout is 0", async () => {
		const options: ExecuteCommandOptions = {
			executionId: "test-execution",
			command: "sleep 10",
			commandExecutionTimeout: 0, // No timeout
		}

		// Create a process that resolves after a delay to simulate a long-running command
		const longRunningProcess = new Promise((resolve) => {
			setTimeout(resolve, 200) // 200ms delay
		})

		mockTerminal.runCommand.mockReturnValue(longRunningProcess)

		const result = await executeCommand(mockTask as Task, options)

		// Should complete successfully without timeout
		expect(result[0]).toBe(false) // Not rejected
		expect(result[1]).not.toContain("terminated after exceeding")
	})

	describe("Command Timeout Allowlist", () => {
		let mockBlock: any
		let mockAskApproval: any
		let mockHandleError: any
		let mockPushToolResult: any
		let mockRemoveClosingTag: any

		beforeEach(() => {
			// Reset mocks for allowlist tests
			vitest.clearAllMocks()
			;(fs.access as any).mockResolvedValue(undefined)
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockTerminal)

			// Mock the executeCommandTool parameters
			mockBlock = {
				params: {
					command: "",
					cwd: undefined,
				},
				partial: false,
			}

			mockAskApproval = vitest.fn().mockResolvedValue(true) // Always approve
			mockHandleError = vitest.fn()
			mockPushToolResult = vitest.fn()
			mockRemoveClosingTag = vitest.fn()

			// Mock task with additional properties needed by executeCommandTool
			mockTask = {
				cwd: "/test/directory",
				terminalProcess: undefined,
				providerRef: {
					deref: vitest.fn().mockResolvedValue({
						postMessageToWebview: vitest.fn(),
						getState: vitest.fn().mockResolvedValue({
							terminalOutputLineLimit: 500,
							terminalShellIntegrationDisabled: false,
						}),
					}),
				},
				say: vitest.fn().mockResolvedValue(undefined),
				consecutiveMistakeCount: 0,
				recordToolError: vitest.fn(),
				sayAndCreateMissingParamError: vitest.fn(),
				rooIgnoreController: {
					validateCommand: vitest.fn().mockReturnValue(null),
				},
				lastMessageTs: Date.now(),
				ask: vitest.fn(),
				didRejectTool: false,
			}
		})

		it("should skip timeout for commands in allowlist", async () => {
			// Mock VSCode configuration with timeout and allowlist
			const mockGetConfiguration = vitest.fn().mockReturnValue({
				get: vitest.fn().mockImplementation((key: string) => {
					if (key === "commandExecutionTimeout") return 1 // 1 second timeout
					if (key === "commandTimeoutAllowlist") return ["npm", "git"]
					return undefined
				}),
			})
			;(vscode.workspace.getConfiguration as any).mockReturnValue(mockGetConfiguration())

			mockBlock.params.command = "npm install"

			// Create a process that would timeout if not allowlisted
			const longRunningProcess = new Promise((resolve) => {
				setTimeout(resolve, 2000) // 2 seconds, longer than 1 second timeout
			})
			mockTerminal.runCommand.mockReturnValue(longRunningProcess)

			await executeCommandTool(
				mockTask as Task,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should complete successfully without timeout because "npm" is in allowlist
			expect(mockPushToolResult).toHaveBeenCalled()
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).not.toContain("terminated after exceeding")
		}, 3000)

		it("should apply timeout for commands not in allowlist", async () => {
			// Mock VSCode configuration with timeout and allowlist
			const mockGetConfiguration = vitest.fn().mockReturnValue({
				get: vitest.fn().mockImplementation((key: string) => {
					if (key === "commandExecutionTimeout") return 1 // 1 second timeout
					if (key === "commandTimeoutAllowlist") return ["npm", "git"]
					return undefined
				}),
			})
			;(vscode.workspace.getConfiguration as any).mockReturnValue(mockGetConfiguration())

			mockBlock.params.command = "sleep 10" // Not in allowlist

			// Create a process that never resolves
			const neverResolvingProcess = new Promise(() => {})
			;(neverResolvingProcess as any).abort = vitest.fn()
			mockTerminal.runCommand.mockReturnValue(neverResolvingProcess)

			await executeCommandTool(
				mockTask as Task,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should timeout because "sleep" is not in allowlist
			expect(mockPushToolResult).toHaveBeenCalled()
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("terminated after exceeding")
		}, 3000)

		it("should handle empty allowlist", async () => {
			// Mock VSCode configuration with timeout and empty allowlist
			const mockGetConfiguration = vitest.fn().mockReturnValue({
				get: vitest.fn().mockImplementation((key: string) => {
					if (key === "commandExecutionTimeout") return 1 // 1 second timeout
					if (key === "commandTimeoutAllowlist") return []
					return undefined
				}),
			})
			;(vscode.workspace.getConfiguration as any).mockReturnValue(mockGetConfiguration())

			mockBlock.params.command = "npm install"

			// Create a process that never resolves
			const neverResolvingProcess = new Promise(() => {})
			;(neverResolvingProcess as any).abort = vitest.fn()
			mockTerminal.runCommand.mockReturnValue(neverResolvingProcess)

			await executeCommandTool(
				mockTask as Task,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should timeout because allowlist is empty
			expect(mockPushToolResult).toHaveBeenCalled()
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("terminated after exceeding")
		}, 3000)

		it("should match command prefixes correctly", async () => {
			// Mock VSCode configuration with timeout and allowlist
			const mockGetConfiguration = vitest.fn().mockReturnValue({
				get: vitest.fn().mockImplementation((key: string) => {
					if (key === "commandExecutionTimeout") return 1 // 1 second timeout
					if (key === "commandTimeoutAllowlist") return ["git log", "npm run"]
					return undefined
				}),
			})
			;(vscode.workspace.getConfiguration as any).mockReturnValue(mockGetConfiguration())

			const longRunningProcess = new Promise((resolve) => {
				setTimeout(resolve, 2000) // 2 seconds
			})
			const neverResolvingProcess = new Promise(() => {})
			;(neverResolvingProcess as any).abort = vitest.fn()

			// Test exact prefix match - should not timeout
			mockBlock.params.command = "git log --oneline"
			mockTerminal.runCommand.mockReturnValueOnce(longRunningProcess)

			await executeCommandTool(
				mockTask as Task,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockPushToolResult).toHaveBeenCalled()
			const result1 = mockPushToolResult.mock.calls[0][0]
			expect(result1).not.toContain("terminated after exceeding")

			// Reset mocks for second test
			mockPushToolResult.mockClear()

			// Test partial prefix match (should not match) - should timeout
			mockBlock.params.command = "git status" // "git" alone is not in allowlist, only "git log"
			mockTerminal.runCommand.mockReturnValueOnce(neverResolvingProcess)

			await executeCommandTool(
				mockTask as Task,
				mockBlock,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockPushToolResult).toHaveBeenCalled()
			const result2 = mockPushToolResult.mock.calls[0][0]
			expect(result2).toContain("terminated after exceeding")
		}, 5000)
	})
})
