import { expect } from "chai"
import { describe, it } from "mocha"
import { ClaudeCodeStreamTranslator } from "./stream-translator"

describe("ClaudeCodeStreamTranslator", () => {
	it("parses complete Claude Code stream chunks", () => {
		const translator = new ClaudeCodeStreamTranslator()

		const chunks = translator.translateStdout('{"type":"result","subtype":"success","total_cost_usd":0,"is_error":false,"duration_ms":1,"duration_api_ms":1,"num_turns":1,"result":"ok","session_id":"s"}')

		expect(chunks).to.have.length(1)
		expect((chunks[0] as any).type).to.equal("result")
	})

	it("buffers partial assistant payloads and flushes them on completion", () => {
		const translator = new ClaudeCodeStreamTranslator()

		expect(translator.translateStdout('{"type":"assistant"')).to.deep.equal([])
		const flushed = translator.flush()

		expect(flushed).to.deep.equal(['{"type":"assistant"'])
	})
})
