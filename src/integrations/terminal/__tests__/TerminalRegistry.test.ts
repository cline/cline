// npx jest src/integrations/terminal/__tests__/TerminalRegistry.test.ts

import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"
import * as vscode from "vscode"

const PAGER = process.platform === "win32" ? "" : "cat"

// Mock vscode.window.createTerminal
const mockCreateTerminal = jest.fn()

// Event handlers for testing
let mockStartHandler: any = null
let mockEndHandler: any = null

jest.mock("vscode", () => ({
	window: {
		createTerminal: (...args: any[]) => {
			mockCreateTerminal(...args)
			return {
				name: "Roo Code",
				exitStatus: undefined,
				dispose: jest.fn(),
				show: jest.fn(),
				hide: jest.fn(),
				sendText: jest.fn(),
			}
		},
		onDidCloseTerminal: jest.fn().mockReturnValue({ dispose: jest.fn() }),
		onDidStartTerminalShellExecution: jest.fn().mockImplementation((handler) => {
			mockStartHandler = handler
			return { dispose: jest.fn() }
		}),
		onDidEndTerminalShellExecution: jest.fn().mockImplementation((handler) => {
			mockEndHandler = handler
			return { dispose: jest.fn() }
		}),
	},
	ThemeIcon: jest.fn(),
}))

jest.mock("execa", () => ({
	execa: jest.fn(),
}))

describe("TerminalRegistry", () => {
	beforeEach(() => {
		mockCreateTerminal.mockClear()

		// Reset event handlers
		mockStartHandler = null
		mockEndHandler = null

		// Clear terminals array for each test
		;(TerminalRegistry as any).terminals = []
		;(TerminalRegistry as any).nextTerminalId = 1
		;(TerminalRegistry as any).isInitialized = false
	})

	describe("createTerminal", () => {
		it("creates terminal with PAGER set appropriately for platform", () => {
			TerminalRegistry.createTerminal("/test/path", "vscode")

			expect(mockCreateTerminal).toHaveBeenCalledWith({
				cwd: "/test/path",
				name: "Roo Code",
				iconPath: expect.any(Object),
				env: {
					PAGER,
					VTE_VERSION: "0",
					PROMPT_EOL_MARK: "",
				},
			})
		})

		it("adds PROMPT_COMMAND when Terminal.getCommandDelay() > 0", () => {
			// Set command delay to 50ms for this test
			const originalDelay = Terminal.getCommandDelay()
			Terminal.setCommandDelay(50)

			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "Roo Code",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						PROMPT_COMMAND: "sleep 0.05",
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
					},
				})
			} finally {
				// Restore original delay
				Terminal.setCommandDelay(originalDelay)
			}
		})

		it("adds Oh My Zsh integration env var when enabled", () => {
			Terminal.setTerminalZshOhMy(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "Roo Code",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
						ITERM_SHELL_INTEGRATION_INSTALLED: "Yes",
					},
				})
			} finally {
				Terminal.setTerminalZshOhMy(false)
			}
		})

		it("adds Powerlevel10k integration env var when enabled", () => {
			Terminal.setTerminalZshP10k(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "Roo Code",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
						POWERLEVEL9K_TERM_SHELL_INTEGRATION: "true",
					},
				})
			} finally {
				Terminal.setTerminalZshP10k(false)
			}
		})
	})

	describe("busy flag management", () => {
		let mockVsTerminal: any

		beforeEach(() => {
			mockVsTerminal = {
				name: "Roo Code",
				exitStatus: undefined,
				dispose: jest.fn(),
				show: jest.fn(),
				hide: jest.fn(),
				sendText: jest.fn(),
			}
			mockCreateTerminal.mockReturnValue(mockVsTerminal)
		})

		// Helper function to get the created Roo terminal and its underlying VSCode terminal
		const createTerminalAndGetVsTerminal = (path: string = "/test/path") => {
			const rooTerminal = TerminalRegistry.createTerminal(path, "vscode")
			// Get the actual VSCode terminal that was created and stored
			const vsTerminal = (rooTerminal as any).terminal
			return { rooTerminal, vsTerminal }
		}

		it("should initialize terminal with busy = false", () => {
			const terminal = TerminalRegistry.createTerminal("/test/path", "vscode")
			expect(terminal.busy).toBe(false)
		})

		it("should set busy = true when shell execution starts", () => {
			// Initialize the registry to set up event handlers
			TerminalRegistry.initialize()

			// Create a terminal and get the actual VSCode terminal
			const { rooTerminal, vsTerminal } = createTerminalAndGetVsTerminal()
			expect(rooTerminal.busy).toBe(false)

			// Simulate shell execution start event
			const execution = {
				commandLine: { value: "echo test" },
				read: jest.fn().mockReturnValue({}),
			} as any

			if (mockStartHandler) {
				mockStartHandler({
					terminal: vsTerminal,
					execution,
				})
			}

			expect(rooTerminal.busy).toBe(true)
		})

		it("should set busy = false when shell execution ends for Roo terminals", () => {
			// Initialize the registry to set up event handlers
			TerminalRegistry.initialize()

			// Create a terminal and get the actual VSCode terminal
			const { rooTerminal, vsTerminal } = createTerminalAndGetVsTerminal()
			rooTerminal.busy = true

			// Set up a mock process to simulate running state
			const mockProcess = {
				command: "echo test",
				isHot: false,
				hasUnretrievedOutput: () => false,
			}
			rooTerminal.process = mockProcess as any

			// Simulate shell execution end event
			const execution = {
				commandLine: { value: "echo test" },
			} as any

			if (mockEndHandler) {
				mockEndHandler({
					terminal: vsTerminal,
					execution,
					exitCode: 0,
				})
			}

			expect(rooTerminal.busy).toBe(false)
		})

		it("should set busy = false when shell execution ends for non-Roo terminals (manual commands)", () => {
			// Initialize the registry to set up event handlers
			TerminalRegistry.initialize()

			// Simulate a shell execution end event for a terminal not in our registry
			const unknownVsTerminal = {
				name: "Unknown Terminal",
			}

			const execution = {
				commandLine: { value: "sleep 30" },
			} as any

			// This should not throw an error and should handle the case gracefully
			expect(() => {
				if (mockEndHandler) {
					mockEndHandler({
						terminal: unknownVsTerminal,
						execution,
						exitCode: 0,
					})
				}
			}).not.toThrow()
		})

		it("should handle busy flag reset when terminal process is not running", () => {
			// Initialize the registry to set up event handlers
			TerminalRegistry.initialize()

			// Create a terminal and get the actual VSCode terminal
			const { rooTerminal, vsTerminal } = createTerminalAndGetVsTerminal()
			rooTerminal.busy = true

			// Ensure terminal.running returns false (no active process)
			Object.defineProperty(rooTerminal, "running", {
				get: () => false,
				configurable: true,
			})

			// Simulate shell execution end event
			const execution = {
				commandLine: { value: "echo test" },
			} as any

			if (mockEndHandler) {
				mockEndHandler({
					terminal: vsTerminal,
					execution,
					exitCode: 0,
				})
			}

			// Should reset busy flag even when not running
			expect(rooTerminal.busy).toBe(false)
		})

		it("should maintain busy state during command execution lifecycle", () => {
			// Initialize the registry to set up event handlers
			TerminalRegistry.initialize()

			// Create a terminal and get the actual VSCode terminal
			const { rooTerminal, vsTerminal } = createTerminalAndGetVsTerminal()
			expect(rooTerminal.busy).toBe(false)

			// Start execution
			const execution = {
				commandLine: { value: "npm test" },
				read: jest.fn().mockReturnValue({}),
			} as any

			if (mockStartHandler) {
				mockStartHandler({
					terminal: vsTerminal,
					execution,
				})
			}

			expect(rooTerminal.busy).toBe(true)

			// Set up mock process for running state
			const mockProcess = {
				command: "npm test",
				isHot: true,
				hasUnretrievedOutput: () => true,
			}
			rooTerminal.process = mockProcess as any

			// End execution
			if (mockEndHandler) {
				mockEndHandler({
					terminal: vsTerminal,
					execution,
					exitCode: 0,
				})
			}

			expect(rooTerminal.busy).toBe(false)
		})
	})
})
