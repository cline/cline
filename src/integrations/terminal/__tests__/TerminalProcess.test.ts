import { TerminalProcess, mergePromise } from "../TerminalProcess"
import * as vscode from "vscode"
import { EventEmitter } from "events"

// Mock vscode
jest.mock("vscode")

describe("TerminalProcess", () => {
    let terminalProcess: TerminalProcess
    let mockTerminal: jest.Mocked<vscode.Terminal & {
        shellIntegration: {
            executeCommand: jest.Mock
        }
    }>
    let mockExecution: any
    let mockStream: AsyncIterableIterator<string>

    beforeEach(() => {
        terminalProcess = new TerminalProcess()
        
        // Create properly typed mock terminal
        mockTerminal = {
            shellIntegration: {
                executeCommand: jest.fn()
            },
            name: "Mock Terminal",
            processId: Promise.resolve(123),
            creationOptions: {},
            exitStatus: undefined,
            state: { isInteractedWith: true },
            dispose: jest.fn(),
            hide: jest.fn(),
            show: jest.fn(),
            sendText: jest.fn()
        } as unknown as jest.Mocked<vscode.Terminal & {
            shellIntegration: {
                executeCommand: jest.Mock
            }
        }>

        // Reset event listeners
        terminalProcess.removeAllListeners()
    })

    describe("run", () => {
        it("handles shell integration commands correctly", async () => {
            const lines: string[] = []
            terminalProcess.on("line", (line) => {
                // Skip empty lines used for loading spinner
                if (line !== "") {
                    lines.push(line)
                }
            })

            // Mock stream data with shell integration sequences
            mockStream = (async function* () {
                // The first chunk contains the command start sequence
                yield "Initial output\n"
                yield "More output\n"
                // The last chunk contains the command end sequence
                yield "Final output"
            })()

            mockExecution = {
                read: jest.fn().mockReturnValue(mockStream)
            }

            mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

            const completedPromise = new Promise<void>((resolve) => {
                terminalProcess.once("completed", resolve)
            })

            await terminalProcess.run(mockTerminal, "test command")
            await completedPromise

            expect(lines).toEqual(["Initial output", "More output", "Final output"])
            expect(terminalProcess.isHot).toBe(false)
        })

        it("handles terminals without shell integration", async () => {
            const noShellTerminal = {
                sendText: jest.fn(),
                shellIntegration: undefined
            } as unknown as vscode.Terminal

            const noShellPromise = new Promise<void>((resolve) => {
                terminalProcess.once("no_shell_integration", resolve)
            })

            await terminalProcess.run(noShellTerminal, "test command")
            await noShellPromise

            expect(noShellTerminal.sendText).toHaveBeenCalledWith("test command", true)
        })

        it("sets hot state for compiling commands", async () => {
            const lines: string[] = []
            terminalProcess.on("line", (line) => {
                if (line !== "") {
                    lines.push(line)
                }
            })

            // Create a promise that resolves when the first chunk is processed
            const firstChunkProcessed = new Promise<void>(resolve => {
                terminalProcess.on("line", () => resolve())
            })

            mockStream = (async function* () {
                yield "compiling...\n"
                // Wait to ensure hot state check happens after first chunk
                await new Promise(resolve => setTimeout(resolve, 10))
                yield "still compiling...\n"
                yield "done"
            })()

            mockExecution = {
                read: jest.fn().mockReturnValue(mockStream)
            }

            mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

            // Start the command execution
            const runPromise = terminalProcess.run(mockTerminal, "npm run build")
            
            // Wait for the first chunk to be processed
            await firstChunkProcessed
            
            // Hot state should be true while compiling
            expect(terminalProcess.isHot).toBe(true)

            // Complete the execution
            const completedPromise = new Promise<void>((resolve) => {
                terminalProcess.once("completed", resolve)
            })

            await runPromise
            await completedPromise

            expect(lines).toEqual(["compiling...", "still compiling...", "done"])
        })
    })

    describe("buffer processing", () => {
        it("correctly processes and emits lines", () => {
            const lines: string[] = []
            terminalProcess.on("line", (line) => lines.push(line))

            // Simulate incoming chunks
            terminalProcess["emitIfEol"]("first line\n")
            terminalProcess["emitIfEol"]("second")
            terminalProcess["emitIfEol"](" line\n")
            terminalProcess["emitIfEol"]("third line")

            expect(lines).toEqual(["first line", "second line"])

            // Process remaining buffer
            terminalProcess["emitRemainingBufferIfListening"]()
            expect(lines).toEqual(["first line", "second line", "third line"])
        })

        it("handles Windows-style line endings", () => {
            const lines: string[] = []
            terminalProcess.on("line", (line) => lines.push(line))

            terminalProcess["emitIfEol"]("line1\r\nline2\r\n")

            expect(lines).toEqual(["line1", "line2"])
        })
    })

    describe("removeLastLineArtifacts", () => {
        it("removes terminal artifacts from output", () => {
            const cases = [
                ["output%", "output"],
                ["output$ ", "output"],
                ["output#", "output"],
                ["output> ", "output"],
                ["multi\nline%", "multi\nline"],
                ["no artifacts", "no artifacts"]
            ]

            for (const [input, expected] of cases) {
                expect(terminalProcess["removeLastLineArtifacts"](input)).toBe(expected)
            }
        })
    })

    describe("continue", () => {
        it("stops listening and emits continue event", () => {
            const continueSpy = jest.fn()
            terminalProcess.on("continue", continueSpy)

            terminalProcess.continue()

            expect(continueSpy).toHaveBeenCalled()
            expect(terminalProcess["isListening"]).toBe(false)
        })
    })

    describe("getUnretrievedOutput", () => {
        it("returns and clears unretrieved output", () => {
            terminalProcess["fullOutput"] = "previous\nnew output"
            terminalProcess["lastRetrievedIndex"] = 9 // After "previous\n"

            const unretrieved = terminalProcess.getUnretrievedOutput()

            expect(unretrieved).toBe("new output")
            expect(terminalProcess["lastRetrievedIndex"]).toBe(terminalProcess["fullOutput"].length)
        })
    })

    describe("mergePromise", () => {
        it("merges promise methods with terminal process", async () => {
            const process = new TerminalProcess()
            const promise = Promise.resolve()

            const merged = mergePromise(process, promise)

            expect(merged).toHaveProperty("then")
            expect(merged).toHaveProperty("catch")
            expect(merged).toHaveProperty("finally")
            expect(merged instanceof TerminalProcess).toBe(true)

            await expect(merged).resolves.toBeUndefined()
        })
    })
})