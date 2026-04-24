import { expect } from "chai"
import path from "path"
import proxyquire from "proxyquire"
import sinon from "sinon"

// Build a mock execa process. exitCode controls what the "close" event emits
// and what `await cProcess` resolves/rejects to.
// For non-zero exit codes, the promise rejects — matching execa's default reject:true.
const createMockProcess = (exitCode = 0) => {
	// Simulate execa: reject on non-zero exit, resolve on zero.
	const awaitResult: Promise<{ exitCode: number }> =
		exitCode !== 0
			? Promise.reject(Object.assign(new Error(`Command failed with exit code ${exitCode}: claude`), { exitCode }))
			: Promise.resolve({ exitCode })

	return {
		stdin: { write: sinon.fake(), end: sinon.fake() },
		stdout: { on: sinon.fake(), resume: sinon.fake() },
		stderr: { on: sinon.fake(() => {}) },
		on: sinon.fake((event: string, callback: (code: number) => void) => {
			if (event === "close") {
				setImmediate(() => callback(exitCode))
			}
		}),
		killed: false,
		kill: sinon.fake(),
		exitCode,
		then: (onResolve: any, onReject?: any) => awaitResult.then(onResolve, onReject),
		catch: (fn: any) => awaitResult.catch(fn),
		finally: (fn: any) => awaitResult.finally(fn),
	}
}

const createMockReadlineInterface = (lines: string[] = []) => ({
	async *[Symbol.asyncIterator]() {
		for (const line of lines) {
			yield line
		}
	},
	close: sinon.fake(),
})

const DEFAULT_LINES = ['{"type":"text","text":"Hello"}', '{"type":"text","text":" world"}']

// mockExeca is called synchronously by runProcess; we reset it per-test via sinon.restore
let mockExeca = sinon.fake((..._args: any[]) => createMockProcess())
let mockReadlineLines: string[] = DEFAULT_LINES
let mockProcessExitCode = 0

let os = "darwin"

const { MAX_SYSTEM_PROMPT_LENGTH, runClaudeCode } = proxyquire("./run", {
	"@/utils/path": {
		getCwd: () => Promise.resolve(path.resolve("./")),
	},
	"node:os": {
		platform: () => os,
	},
	readline: {
		createInterface: () => createMockReadlineInterface(mockReadlineLines),
	},
})

// Helper: build an options object that injects mockExeca directly,
// bypassing the dynamic import("execa") that proxyquire cannot intercept.
const makeOptions = (overrides: Record<string, unknown> = {}) => ({
	systemPrompt: "system",
	messages: [],
	modelId: "test",
	path: "echo",
	_execa: (...args: any[]) => {
		mockExeca(...args)
		return createMockProcess(mockProcessExitCode)
	},
	...overrides,
})

describe("Claude Code Integration", () => {
	afterEach(() => {
		sinon.restore()
		mockExeca = sinon.fake((..._args: any[]) => createMockProcess())
		mockReadlineLines = DEFAULT_LINES
		mockProcessExitCode = 0
	})

	const itCallsTheScriptWithAFile = (systemPrompt: string) => {
		it("calls the script using with a file", async () => {
			const cProcess = runClaudeCode(makeOptions({ systemPrompt }))

			const chunks: string[] = []
			for await (const chunk of cProcess) {
				chunks.push(chunk)
			}

			expect(chunks).to.have.length(2)

			const lastExecaCall = mockExeca.lastCall
			expect(lastExecaCall).to.not.be.null
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
				const cProcess = runClaudeCode(makeOptions({ systemPrompt: SYSTEM_PROMPT }))

				const chunks: string[] = []
				for await (const chunk of cProcess) {
					chunks.push(chunk)
				}

				expect(chunks).to.have.length(2)

				const lastExecaCall = mockExeca.lastCall
				expect(lastExecaCall).to.not.be.null
				const params = lastExecaCall.args[1]
				expect(params).to.not.be.null
				expect(params.includes("--system-prompt-file")).to.be.false
				expect(params.includes("--system-prompt")).to.be.true
			})
		})
	})

	describe("seenMaxTurns / exit-code handling", () => {
		it("should not throw when process exits code 1 after error_max_turns result", async () => {
			// CLI exits with code 1 on --max-turns exhaustion. Without seenMaxTurns
			// tracking this would throw "Claude Code process exited with code 1".
			mockReadlineLines = [
				JSON.stringify({
					type: "assistant",
					message: {
						content: [{ type: "tool_use", id: "t1", name: "write_to_file", input: {} }],
						usage: { input_tokens: 10, output_tokens: 5 },
						stop_reason: "tool_use",
					},
				}),
				JSON.stringify({
					type: "result",
					subtype: "error_max_turns",
					is_error: true,
					total_cost_usd: 0.001,
					duration_ms: 1000,
					duration_api_ms: 900,
					num_turns: 1,
					session_id: "test",
				}),
			]
			mockProcessExitCode = 1

			let threw = false
			try {
				for await (const _ of runClaudeCode(makeOptions())) {
					// consume
				}
			} catch {
				threw = true
			}

			expect(threw).to.be.false
		})

		it("should throw when process exits code 1 without error_max_turns", async () => {
			// A genuine non-zero exit (not max-turns) should still propagate as an error.
			mockReadlineLines = [
				JSON.stringify({
					type: "assistant",
					message: {
						content: [{ type: "text", text: "Hello" }],
						usage: { input_tokens: 10, output_tokens: 5 },
						stop_reason: "end_turn",
					},
				}),
			]
			mockProcessExitCode = 1

			let thrownError: Error | undefined
			try {
				for await (const _ of runClaudeCode(makeOptions())) {
					// consume
				}
			} catch (err) {
				thrownError = err as Error
			}

			expect(thrownError).to.not.be.undefined
			// execa rejects with "Command failed with exit code 1: ..." which catch re-wraps
			expect(thrownError!.message).to.include("exit code 1")
		})
	})
})
