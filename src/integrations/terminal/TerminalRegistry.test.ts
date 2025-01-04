import { describe, it, expect, beforeEach, vi } from "vitest"
import { TerminalRegistry, TerminalInfo } from "./TerminalRegistry"
import * as vscode from "vscode"

interface MockTerminalExitStatus {
	code: number | undefined
}

vi.mock("vscode", () => ({
	window: {
		terminals: [],
		activeTerminal: undefined,
		onDidChangeActiveTerminal: vi.fn(),
		createTerminal: vi.fn((options: vscode.TerminalOptions) => {
			const terminal: vscode.Terminal & { _exitStatus?: MockTerminalExitStatus } = {
				name: options.name || "Mock Terminal",
				processId: Promise.resolve(1234),
				creationOptions: options,
				get exitStatus(): MockTerminalExitStatus | undefined {
					return this._exitStatus
				},
				set exitStatus(value: MockTerminalExitStatus | undefined) {
					this._exitStatus = value
				},
				state: { isInteractedWith: false },
				shellIntegration: undefined,
				sendText: vi.fn(),
				show: vi.fn(),
				hide: vi.fn(),
				dispose: vi.fn(),
			}

			return terminal
		}),
		onDidOpenTerminal: vi.fn(),
		onDidCloseTerminal: vi.fn(),
		onDidChangeTerminalState: vi.fn(),
		onDidChangeTerminalShellIntegration: vi.fn(),
		onDidStartTerminalShellExecution: vi.fn(),
		onDidEndTerminalShellExecution: vi.fn(),
		activeTextEditor: undefined,
		onDidChangeActiveTextEditor: vi.fn(),
		showTextDocument: vi.fn(),
		createStatusBarItem: vi.fn(),
	},
	ThemeIcon: class {
		constructor(public id: string) {}
		static File = new this("file")
		static Folder = new this("folder")
	},
}))

describe("TerminalRegistry", () => {
	beforeEach(() => {
		// Reset the internal state before each test
		;(TerminalRegistry as any).terminals = []
		;(TerminalRegistry as any).nextTerminalId = 1
	})

	describe("createTerminal", () => {
		it("should create a terminal with correct default properties", () => {
			const terminalInfo = TerminalRegistry.createTerminal()

			expect(terminalInfo).toHaveProperty("id", 1)
			expect(terminalInfo).toHaveProperty("busy", false)
			expect(terminalInfo).toHaveProperty("lastCommand", "")
			expect(terminalInfo.terminal).toBeDefined()
		})

		it("should create terminals with incrementing IDs", () => {
			const terminal1 = TerminalRegistry.createTerminal()
			const terminal2 = TerminalRegistry.createTerminal()

			expect(terminal1.id).toBe(1)
			expect(terminal2.id).toBe(2)
		})

		it("should create a terminal with specified working directory", () => {
			const cwd = "/test/path"
			const terminalInfo = TerminalRegistry.createTerminal(cwd)

			expect(vscode.window.createTerminal).toHaveBeenCalledWith({
				cwd,
				name: "Cline",
				iconPath: expect.any(vscode.ThemeIcon),
			})
		})
	})

	describe("getTerminal", () => {
		it("should retrieve an existing terminal by ID", () => {
			const originalTerminal = TerminalRegistry.createTerminal()
			const retrievedTerminal = TerminalRegistry.getTerminal(originalTerminal.id)

			expect(retrievedTerminal).toBe(originalTerminal)
		})

		it("should return undefined for non-existent terminal", () => {
			const retrievedTerminal = TerminalRegistry.getTerminal(999)
			expect(retrievedTerminal).toBeUndefined()
		})

		it("should remove and return undefined for closed terminal", () => {
			const terminal = TerminalRegistry.createTerminal()

			// Simulate terminal closure by setting exitStatus
			terminal.terminal.exitStatus = { code: 0 }

			const retrievedTerminal = TerminalRegistry.getTerminal(terminal.id)

			expect(retrievedTerminal).toBeUndefined()
		})
	})

	describe("removeTerminal", () => {
		it("should remove a terminal by ID", () => {
			const terminal1 = TerminalRegistry.createTerminal()
			const terminal2 = TerminalRegistry.createTerminal()

			TerminalRegistry.removeTerminal(terminal1.id)

			const remainingTerminals = (TerminalRegistry as any).terminals
			expect(remainingTerminals).toHaveLength(1)
			expect(remainingTerminals[0]).toBe(terminal2)
		})
	})

	describe("updateTerminal", () => {
		it("should update terminal properties", () => {
			const terminal = TerminalRegistry.createTerminal()

			TerminalRegistry.updateTerminal(terminal.id, {
				busy: true,
				lastCommand: "test command",
			})

			const updatedTerminal = TerminalRegistry.getTerminal(terminal.id)

			expect(updatedTerminal).toHaveProperty("busy", true)
			expect(updatedTerminal).toHaveProperty("lastCommand", "test command")
		})

		it("should not update non-existent terminal", () => {
			TerminalRegistry.updateTerminal(999, {
				busy: true,
				lastCommand: "test command",
			})

			// No error should be thrown
		})
	})

	describe("getAllTerminals", () => {
		it("should return all active terminals", () => {
			const terminal1 = TerminalRegistry.createTerminal()
			const terminal2 = TerminalRegistry.createTerminal()

			// Simulate first terminal being closed
			terminal1.terminal.exitStatus = { code: 0 }

			const activeTerminals = TerminalRegistry.getAllTerminals()

			expect(activeTerminals).toHaveLength(1)
			expect(activeTerminals[0]).toBe(terminal2)
		})
	})
})
