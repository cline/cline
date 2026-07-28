import { expect } from "chai"
import path from "path"
import proxyquire from "proxyquire"
import sinon from "sinon"

const DEFAULT_OUTPUT_LINES = ['{"type":"text","text":"Hello"}', '{"type":"text","text":" world"}']

// Mutable state the mock factories read, so individual tests can simulate
// different CLI output streams and exit results.
let mockOutputLines = DEFAULT_OUTPUT_LINES
let mockProcessError: Error | null = null

const createMockProcess = () => {
	const exitCode = mockProcessError ? ((mockProcessError as any).exitCode ?? 1) : 0
	const mockProcess = {
		stdin: {
			write: sinon.fake(),
			end: sinon.fake(),
		},
		stdout: {
			on: sinon.fake(),
			resume: sinon.fake(),
		},
		stderr: {
			on: sinon.fake(() => {}),
		},
		on: sinon.fake((event, callback) => {
			if (event === "close") {
				setImmediate(() => callback(exitCode))
			}
			if (event === "error") {
			}
		}),
		killed: false,
		kill: sinon.fake(),
		exitCode,
		then: (onResolve: (value: any) => void, onReject?: (reason: any) => void) => {
			// execa's process promise rejects on nonzero exit (default `reject: true`)
			if (mockProcessError && onReject) {
				setImmediate(() => onReject(mockProcessError))
				return Promise.resolve()
			}
			setImmediate(() => onResolve({ exitCode: 0 }))
			return Promise.resolve({ exitCode: 0 })
		},
		catch: () => Promise.resolve({ exitCode: 0 }),
		finally: (callback: () => void) => {
			setImmediate(callback)
			return Promise.resolve({ exitCode: 0 })
		},
	}
	return mockProcess
}

const createMockReadlineInterface = () => {
	const mockInterface = {
		async *[Symbol.asyncIterator]() {
			// Simulate Claude CLI JSON output - yield the configured chunks then end
			yield* mockOutputLines
			// Iterator ends naturally when function returns
			return
		},
		close: sinon.fake(),
	}
	return mockInterface
}

const mockExeca = sinon.fake((..._args) => {
	return createMockProcess()
})

let os = "darwin"

const { MAX_SYSTEM_PROMPT_LENGTH, runClaudeCode } = proxyquire("./run", {
	"@/utils/path": {
		getCwd: () => Promise.resolve(path.resolve("./")),
	},
	"node:os": {
		platform: () => os,
	},
	execa: {
		execa: mockExeca,
	},
	readline: {
		createInterface: createMockReadlineInterface,
	},
})

describe("Claude Code Integration", () => {
	const scriptPath = "echo"

	afterEach(() => {
		sinon.restore()
		mockOutputLines = DEFAULT_OUTPUT_LINES
		mockProcessError = null
	})

	const itCallsTheScriptWithAFile = (systemPrompt: string) => {
		it("calls the script using with a file", async () => {
			const cProcess = runClaudeCode({
				systemPrompt,
				messages: [],
				modelId: "test",
				path: scriptPath,
			})

			const chunks: string[] = []
			for await (const chunk of cProcess) {
				chunks.push(chunk)
			}

			expect(chunks).to.have.length(2)

			const lastExecaCall = mockExeca.lastCall
			const params = lastExecaCall.args[1]
			expect(params).to.not.be.null
			expect(params.includes("--system-prompt-file")).to.be.true
			expect(params.includes("--system-prompt")).to.be.false
		})
	}

	describe("when it's running on Windows", () => {
		beforeEach(() => {
			os = "win32"
		})

		describe("when the system prompt is longer than the MAX_SYSTEM_PROMPT_LENGTH", () => {
			const SYSTEM_PROMPT = "a".repeat(MAX_SYSTEM_PROMPT_LENGTH * 1.2)

			itCallsTheScriptWithAFile(SYSTEM_PROMPT)
		})

		describe("when the system prompt is shorter than the MAX_SYSTEM_PROMPT_LENGTH", () => {
			const SYSTEM_PROMPT = "a".repeat(MAX_SYSTEM_PROMPT_LENGTH / 2)

			itCallsTheScriptWithAFile(SYSTEM_PROMPT)
		})
	})

	describe("when it's not running on Windows", () => {
		beforeEach(() => {
			os = "darwin"
		})

		describe("when the system prompt is longer than the MAX_SYSTEM_PROMPT_LENGTH", () => {
			const SYSTEM_PROMPT = "a".repeat(MAX_SYSTEM_PROMPT_LENGTH * 1.2)

			itCallsTheScriptWithAFile(SYSTEM_PROMPT)
		})

		describe("when the system prompt is shorter than the MAX_SYSTEM_PROMPT_LENGTH", () => {
			const SYSTEM_PROMPT = "a".repeat(MAX_SYSTEM_PROMPT_LENGTH / 2)

			it("calls the script without a file", async () => {
				const cProcess = runClaudeCode({
					systemPrompt: SYSTEM_PROMPT,
					messages: [],
					modelId: "test",
					path: scriptPath,
				})

				const chunks: string[] = []
				for await (const chunk of cProcess) {
					chunks.push(chunk)
				}

				expect(chunks).to.have.length(2)

				const lastExecaCall = mockExeca.lastCall
				const params = lastExecaCall.args[1]
				expect(params).to.not.be.null
				expect(params.includes("--system-prompt-file")).to.be.false
				expect(params.includes("--system-prompt")).to.be.true
			})
		})
	})

	describe("when the process exits with code 1", () => {
		// Mimics execa's rejection: an Error carrying exitCode, whose message
		// includes the full command after ": "
		const createExitCodeOneError = () => {
			const error = new Error("Command failed with exit code 1: claude --system-prompt aaa --verbose")
			;(error as any).exitCode = 1
			return error
		}

		const collectChunks = async () => {
			const chunks: unknown[] = []
			for await (const chunk of runClaudeCode({
				systemPrompt: "test",
				messages: [],
				modelId: "test",
				path: scriptPath,
			})) {
				chunks.push(chunk)
			}
			return chunks
		}

		describe("after a result chunk was streamed (max-turns exit)", () => {
			beforeEach(() => {
				mockOutputLines = [
					'{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}',
					'{"type":"result","subtype":"success","is_error":false,"num_turns":1}',
				]
				mockProcessError = createExitCodeOneError()
			})

			it("suppresses the error and yields the full response", async () => {
				const chunks = await collectChunks()

				expect(chunks).to.have.length(2)
				expect((chunks[1] as { type: string }).type).to.equal("result")
			})
		})

		describe("without a result chunk", () => {
			beforeEach(() => {
				mockOutputLines = ['{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}']
				mockProcessError = createExitCodeOneError()
			})

			it("throws", async () => {
				try {
					await collectChunks()
					expect.fail("expected runClaudeCode to throw")
				} catch (error) {
					expect((error as Error).message).to.include("Command failed with exit code 1")
				}
			})
		})
	})
})
