import "should"
import { ApiFormat } from "@shared/proto/cline/models"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import sinon from "sinon"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { HicapHandler } from "../hicap"

describe("HicapHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: unknown[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	const tools: ChatCompletionTool[] = [
		{ type: "function", function: { name: "read_file", description: "", parameters: { type: "object" } } },
	]

	it("passes native tools to chat completions", async () => {
		const handler = new HicapHandler({
			hicapApiKey: "test-api-key",
			hicapModelId: "gpt-5.5",
			reasoningEffort: "high",
			hicapMaxOutputTokens: 4096,
			hicapTemperature: 0.2,
		})
		const createStub = sinon.stub().resolves(createAsyncIterable([]))
		const fakeClient = {
			chat: {
				completions: {
					create: createStub,
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
			// drain stream
		}

		const payload = createStub.firstCall.args[0]
		payload.tools.should.deepEqual(tools)
		payload.tool_choice.should.equal("auto")
		payload.reasoning_effort.should.equal("high")
		payload.max_tokens.should.equal(4096)
		payload.temperature.should.equal(0.2)
	})

	it("passes thinking config and reasoning effort to chat completions when enabled for a non-GPT model", async () => {
		const handler = new HicapHandler({
			hicapApiKey: "test-api-key",
			hicapModelId: "claude-sonnet-4.6",
			reasoningEffort: "high",
			thinkingBudgetTokens: 1024,
		})
		const createStub = sinon.stub().resolves(
			createAsyncIterable([
				{
					choices: [
						{
							delta: {
								thinking: "checking the plan",
							},
						},
					],
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
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		const chunks = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
			chunks.push(chunk)
		}

		const payload = createStub.firstCall.args[0]
		payload.reasoning_effort.should.equal("high")
		payload.thinking.should.deepEqual({ type: "enabled", budget_tokens: 1024 })
		chunks.should.deepEqual([{ type: "reasoning", reasoning: "checking the plan" }])
	})

	it("routes to Responses API when enabled", async () => {
		const handler = new HicapHandler({
			hicapApiKey: "test-api-key",
			hicapModelId: "gpt-5.5",
			hicapUseResponsesApi: true,
			reasoningEffort: "medium",
			hicapMaxOutputTokens: 2048,
			hicapTemperature: 0.4,
		})
		const createStub = sinon.stub().resolves(createAsyncIterable([{ type: "response.completed", response: { usage: {} } }]))
		const fakeClient = {
			responses: {
				create: createStub,
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
			// drain stream
		}

		const payload = createStub.firstCall.args[0]
		payload.model.should.equal("gpt-5.5")
		payload.instructions.should.equal("system")
		payload.stream.should.equal(true)
		payload.tools[0].name.should.equal("read_file")
		payload.include.should.deepEqual(["reasoning.encrypted_content"])
		payload.reasoning.should.deepEqual({ effort: "medium", summary: "auto" })
		payload.max_output_tokens.should.equal(2048)
		payload.temperature.should.equal(0.4)
	})

	it("chains Responses API calls from the previous response id", async () => {
		const handler = new HicapHandler({
			hicapApiKey: "test-api-key",
			hicapModelId: "gpt-5.5",
			hicapUseResponsesApi: true,
			reasoningEffort: "medium",
		})
		const createStub = sinon.stub().resolves(createAsyncIterable([]))
		const fakeClient = {
			responses: {
				create: createStub,
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)
		const messages: ClineStorageMessage[] = [
			{ role: "user", content: "previous question" },
			{
				role: "assistant",
				id: "resp_previous",
				ts: Date.now(),
				content: [{ type: "text", text: "previous answer" }],
			},
			{ role: "user", content: "next question" },
		]

		for await (const _chunk of handler.createMessage("system", messages, tools)) {
			// drain stream
		}

		const payload = createStub.firstCall.args[0]
		payload.previous_response_id.should.equal("resp_previous")
		payload.store.should.equal(true)
		payload.input.should.deepEqual([{ role: "user", content: [{ type: "input_text", text: "next question" }] }])
	})

	it("falls back to full Responses API input when previous response is not found", async () => {
		const handler = new HicapHandler({
			hicapApiKey: "test-api-key",
			hicapModelId: "gpt-5.5",
			hicapUseResponsesApi: true,
			reasoningEffort: "medium",
		})
		const createStub = sinon
			.stub()
			.onFirstCall()
			.rejects({ code: "previous_response_not_found", message: "Previous response with id 'resp_previous' not found." })
			.onSecondCall()
			.resolves(createAsyncIterable([]))
		const fakeClient = {
			responses: {
				create: createStub,
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)
		const messages: ClineStorageMessage[] = [
			{ role: "user", content: "previous question" },
			{
				role: "assistant",
				id: "resp_previous",
				ts: Date.now(),
				content: [{ type: "text", text: "previous answer" }],
			},
			{ role: "user", content: "next question" },
		]

		for await (const _chunk of handler.createMessage("system", messages, tools)) {
			// drain stream
		}

		createStub.callCount.should.equal(2)
		const retryPayload = createStub.secondCall.args[0]
		;(retryPayload.previous_response_id === undefined).should.equal(true)
		retryPayload.store.should.equal(true)
		retryPayload.input.should.deepEqual([
			{ role: "user", content: [{ type: "input_text", text: "previous question" }] },
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "previous answer" }] },
			{ role: "user", content: [{ type: "input_text", text: "next question" }] },
		])
	})

	it("omits reasoning when reasoning effort is none", async () => {
		const handler = new HicapHandler({
			hicapApiKey: "test-api-key",
			hicapModelId: "gpt-5.5",
			hicapUseResponsesApi: true,
			reasoningEffort: "none",
		})
		const createStub = sinon.stub().resolves(createAsyncIterable([]))
		const fakeClient = {
			responses: {
				create: createStub,
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
			// drain stream
		}

		const payload = createStub.firstCall.args[0]
		;(payload.reasoning === undefined).should.equal(true)
	})

	it("uses provider default temperature when HiCap temperature is unset", async () => {
		const handler = new HicapHandler({
			hicapApiKey: "test-api-key",
			hicapModelId: "test-model",
		})
		const createStub = sinon.stub().resolves(createAsyncIterable([]))
		const fakeClient = {
			chat: {
				completions: {
					create: createStub,
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
			// drain stream
		}

		const payload = createStub.firstCall.args[0]
		;(payload.temperature === undefined).should.equal(true)
	})

	it("marks model info as OpenAI Responses when Responses API is enabled", () => {
		const handler = new HicapHandler({
			hicapApiKey: "test-api-key",
			hicapModelId: "gpt-5.5",
			hicapUseResponsesApi: true,
		})

		const isResponsesApi = handler.getModel().info.apiFormat === ApiFormat.OPENAI_RESPONSES
		isResponsesApi.should.equal(true)
	})

	it("falls back to chat completions when Responses API is enabled for a non-GPT model", async () => {
		const handler = new HicapHandler({
			hicapApiKey: "test-api-key",
			hicapModelId: "claude-sonnet-4.6",
			hicapUseResponsesApi: true,
		})
		const chatCreateStub = sinon.stub().resolves(createAsyncIterable([]))
		const responsesCreateStub = sinon.stub().resolves(createAsyncIterable([]))
		const fakeClient = {
			chat: {
				completions: {
					create: chatCreateStub,
				},
			},
			responses: {
				create: responsesCreateStub,
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
			// drain stream
		}

		chatCreateStub.calledOnce.should.equal(true)
		responsesCreateStub.notCalled.should.equal(true)
		;(handler.getModel().info.apiFormat === ApiFormat.OPENAI_RESPONSES).should.equal(false)
	})
})
