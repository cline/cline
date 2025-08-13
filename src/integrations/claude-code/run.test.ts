import { expect } from "chai"
import path from "path"
import proxyquire from "proxyquire"
import sinon from "sinon"

const createMockProcess = () => {
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
				setImmediate(() => callback(0))
			}
			if (event === "error") {
			}
		}),
		killed: false,
		kill: sinon.fake(),
		exitCode: 0,
		then: (onResolve: (value: any) => void) => {
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
			// Simulate Claude CLI JSON output - yield a few chunks then end
			yield '{"type":"text","text":"Hello"}'
			yield '{"type":"text","text":" world"}'
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
})
