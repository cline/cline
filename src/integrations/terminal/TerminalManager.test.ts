// @ts-nocheck
import { describe, it, expect, vi, afterAll } from "vitest"
import * as vscode from "vscode"
import { TerminalManager } from "./TerminalManager"
import { TerminalInfo } from "./TerminalRegistry"
import pWaitFor from "p-wait-for"
import { EventEmitter } from "events"

// Mock pWaitFor
vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(() => Promise.resolve()),
}))

const pWaitForMock = vi.mocked(pWaitFor)

vi.mock("vscode", async () => {
	const actualVscode = await vi.importActual<typeof import("vscode")>("vscode")
	return {
		...actualVscode,
		window: {
			...actualVscode.window,
			onDidStartTerminalShellExecution: vi.fn(),
		},
		workspace: {
			...actualVscode.workspace,
			workspaceFolders: [
				{
					uri: {
						scheme: "file",
						path: "/path/to/mock/workspace",
						fsPath: "/path/to/mock/workspace",
						with: vi.fn(),
						toString: vi.fn(),
						toJSON: vi.fn(),
					},
				},
			],
		},
	}
})

vi.mock("./TerminalRegistry", () => ({
	TerminalRegistry: {
		removeTerminal: vi.fn(),
	},
}))

class MockTerminalProcess extends EventEmitter {
	waitForShellIntegration: boolean = true
	run = vi.fn()
}

vi.mock("./TerminalProcess", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./TerminalProcess")>()
	return {
		...actual,
		TerminalProcess: vi.fn().mockImplementation(() => new MockTerminalProcess()),
		mergePromise: (process: any, promise: Promise<any>) => promise,
	}
})

describe("TerminalManager runCommand", () => {
	afterAll(() => {
		vi.resetAllMocks()
	})

	it("should run command immediately when shell integration is active", async () => {
		const terminalManager = new TerminalManager()
		const mockTerminal = {
			shellIntegration: true,
			sendText: vi.fn(),
		} as unknown as vscode.Terminal
		const terminalInfo = {
			id: "test1",
			terminal: mockTerminal,
			busy: false,
		} as TerminalInfo

		const result = terminalManager.runCommand(terminalInfo, "test command")

		expect(terminalInfo.busy).toBe(true)
		expect(terminalInfo.lastCommand).toBe("test command")
		const process = terminalManager["processes"].get("test1")
		expect(process).toBeDefined()
		expect(process?.waitForShellIntegration).toBe(false)
		expect(process?.run).toHaveBeenCalledWith(mockTerminal, "test command")
	})

	it("should wait for shell integration when not active", async () => {
		const terminalManager = new TerminalManager()
		const mockTerminal = {
			shellIntegration: undefined,
			sendText: vi.fn(),
		} as unknown as vscode.Terminal
		const terminalInfo = {
			id: "test2",
			terminal: mockTerminal,
			busy: false,
		} as TerminalInfo

		const result = terminalManager.runCommand(terminalInfo, "test command")

		expect(terminalInfo.busy).toBe(true)
		expect(pWaitForMock).toHaveBeenCalledWith(expect.any(Function), { timeout: 4000 })
	})

	it("should handle no shell integration event", async () => {
		const terminalManager = new TerminalManager()
		const mockTerminal = {
			shellIntegration: undefined,
			sendText: vi.fn(),
		} as unknown as vscode.Terminal
		const terminalInfo = {
			id: "test3",
			terminal: mockTerminal,
			busy: false,
		} as TerminalInfo

		const result = terminalManager.runCommand(terminalInfo, "test command")

		const process = terminalManager["processes"].get("test3")
		process?.emit("no_shell_integration")

		expect(terminalManager["terminalIds"].has("test3")).toBe(false)
		expect(terminalManager["processes"].has("test3")).toBe(false)
	})

	it("should handle command completion", async () => {
		const terminalManager = new TerminalManager()
		const mockTerminal = {
			shellIntegration: true,
			sendText: vi.fn(),
		} as unknown as vscode.Terminal
		const terminalInfo = {
			id: "test4",
			terminal: mockTerminal,
			busy: false,
		} as TerminalInfo

		const promise = terminalManager.runCommand(terminalInfo, "test command")

		const process = terminalManager["processes"].get("test4")
		process?.emit("completed")
		process?.emit("continue")

		await promise
		expect(terminalInfo.busy).toBe(false)
	}, 10000)

	it("should handle command errors", async () => {
		const terminalManager = new TerminalManager()
		const mockTerminal = {
			shellIntegration: true,
			sendText: vi.fn(),
		} as unknown as vscode.Terminal
		const terminalInfo = {
			id: "test5",
			terminal: mockTerminal,
			busy: false,
		} as TerminalInfo

		const result = terminalManager.runCommand(terminalInfo, "test command")

		const process = terminalManager["processes"].get("test5")
		const error = new Error("Test error")
		process?.emit("error", error)

		await expect(result).rejects.toThrow("Test error")
	})
})
