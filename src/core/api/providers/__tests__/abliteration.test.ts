import "should"
import { abliterationModels } from "@shared/api"
import sinon from "sinon"
import { AbliterationHandler } from "../abliteration"

describe("AbliterationHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	it("uses the documented default model", () => {
		const handler = new AbliterationHandler({
			abliterationApiKey: "test-api-key",
		})

		handler.getModel().should.deepEqual({
			id: "abliterated-model",
			info: abliterationModels["abliterated-model"],
		})
	})

	it("streams text, tool calls, and usage through the OpenAI-compatible API", async () => {
		const handler = new AbliterationHandler({
			abliterationApiKey: "test-api-key",
		})
		const createStub = sinon.stub().resolves(
			createAsyncIterable([
				{
					choices: [{ delta: { content: "hello" } }],
				},
				{
					choices: [
						{
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "call_1",
										type: "function",
										function: { name: "read_file", arguments: "{}" },
									},
								],
							},
						},
					],
				},
				{
					choices: [{}],
					usage: {
						prompt_tokens: 1_000_000,
						completion_tokens: 2_000_000,
					},
				},
			]),
		)
		const fakeClient = {
			chat: {
				completions: {
					create: createStub,
				},
			},
		}
		const tools = [{ type: "function", function: { name: "read_file", description: "", parameters: { type: "object" } } }]

		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools as any)) {
			chunks.push(chunk)
		}

		const payload = createStub.firstCall.args[0]
		payload.model.should.equal("abliterated-model")
		payload.messages[0].should.deepEqual({ role: "system", content: "system" })
		payload.stream.should.equal(true)
		payload.stream_options.should.deepEqual({ include_usage: true })
		payload.tools.should.equal(tools)

		chunks.should.deepEqual([
			{ type: "text", text: "hello" },
			{
				type: "tool_calls",
				tool_call: {
					index: 0,
					id: "call_1",
					type: "function",
					function: {
						id: "call_1",
						name: "read_file",
						arguments: "{}",
					},
				},
			},
			{
				type: "usage",
				inputTokens: 1_000_000,
				outputTokens: 2_000_000,
				totalCost: 9,
			},
		])
	})
})
