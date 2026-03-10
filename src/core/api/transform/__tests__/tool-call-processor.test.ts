import "should"
import { getOpenAIToolParams, ToolCallProcessor } from "../tool-call-processor"

describe("ToolCallProcessor", () => {
	it("should preserve tool call id/name for interleaved parallel deltas", () => {
		const processor = new ToolCallProcessor()

		const firstChunk = [
			{
				index: 0,
				id: "call_a",
				function: { name: "read_file" },
			},
			{
				index: 1,
				id: "call_b",
				function: { name: "search_files" },
			},
		] as any

		const secondChunk = [
			{
				index: 1,
				function: { arguments: '{"path":"src"}' },
			},
			{
				index: 0,
				function: { arguments: '{"path":"README.md"}' },
			},
		] as any

		const firstResult = [...processor.processToolCallDeltas(firstChunk)]
		const secondResult = [...processor.processToolCallDeltas(secondChunk)]

		firstResult.should.have.length(0)
		secondResult.should.have.length(2)
		const firstToolCall = secondResult[0]!.tool_call as any
		const secondToolCall = secondResult[1]!.tool_call as any
		firstToolCall.function.id.should.equal("call_b")
		firstToolCall.function.name.should.equal("search_files")
		secondToolCall.function.id.should.equal("call_a")
		secondToolCall.function.name.should.equal("read_file")
	})

	it("should clear accumulated state on reset", () => {
		const processor = new ToolCallProcessor()

		const setupChunk = [
			{
				index: 0,
				id: "call_reset",
				function: { name: "read_file" },
			},
		] as any

		const argsChunk = [
			{
				index: 0,
				function: { arguments: '{"path":"after-reset"}' },
			},
		] as any

		;[...processor.processToolCallDeltas(setupChunk)].should.have.length(0)
		processor.reset()
		;[...processor.processToolCallDeltas(argsChunk)].should.have.length(0)

		const newSetupChunk = [
			{
				index: 0,
				id: "call_new",
				function: { name: "write_file" },
			},
		] as any

		const newArgsChunk = [
			{
				index: 0,
				function: { arguments: '{"path":"file.txt"}' },
			},
		] as any

		;[...processor.processToolCallDeltas(newSetupChunk)].should.have.length(0)
		;[...processor.processToolCallDeltas(newArgsChunk)].should.have.length(1)
	})
})

describe("getOpenAIToolParams", () => {
	it("should include parallel_tool_calls when enabled", () => {
		const tools = [
			{ type: "function", function: { name: "read_file", description: "", parameters: { type: "object" } } },
		] as any
		const params = getOpenAIToolParams(tools, true) as any

		params.parallel_tool_calls.should.equal(true)
	})

	it("should include parallel_tool_calls=false when disabled by default", () => {
		const tools = [
			{ type: "function", function: { name: "read_file", description: "", parameters: { type: "object" } } },
		] as any
		const params = getOpenAIToolParams(tools, false) as any

		params.parallel_tool_calls.should.equal(false)
	})

	it("should not include parallel_tool_calls when tools are absent", () => {
		const params = getOpenAIToolParams(undefined, false) as any

		params.should.not.have.property("parallel_tool_calls")
	})
})
