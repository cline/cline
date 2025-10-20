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
			// Simulate Claude CLI JSON output with streaming events from --include-partial-messages
			yield '{\"type\":\"stream_event\",\"event\":{\"type\":\"message_start\",\"message\":{\"model\":\"claude-sonnet-4-5\",\"id\":\"msg_123\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":100,\"output_tokens\":0}}},\"session_id\":\"test\",\"parent_tool_use_id\":null,\"uuid\":\"uuid1\"}'
			yield '{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}},\"session_id\":\"test\",\"parent_tool_use_id\":null,\"uuid\":\"uuid2\"}'
			yield '{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}},\"session_id\":\"test\",\"parent_tool_use_id\":null,\"uuid\":\"uuid3\"}'
			yield '{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}},\"session_id\":\"test\",\"parent_tool_use_id\":null,\"uuid\":\"uuid4\"}'
			yield '{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_stop\",\"index\":0},\"session_id\":\"test\",\"parent_tool_use_id\":null,\"uuid\":\"uuid5\"}'
			yield '{\"type\":\"stream_event\",\"event\":{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":null},\"usage\":{\"output_tokens\":5}},\"session_id\":\"test\",\"parent_tool_use_id\":null,\"uuid\":\"uuid6\"}'
			yield '{\"type\":\"stream_event\",\"event\":{\"type\":\"message_stop\"},\"session_id\":\"test\",\"parent_tool_use_id\":null,\"uuid\":\"uuid7\"}'
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
