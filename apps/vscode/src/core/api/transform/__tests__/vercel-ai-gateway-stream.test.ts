import { describe, it } from "mocha"
import "should"
import type { ModelInfo } from "@shared/api"
import sinon from "sinon"
import { createVercelAIGatewayStream } from "../vercel-ai-gateway-stream"

describe("createVercelAIGatewayStream", () => {
	const createAsyncIterable = () => ({
		async *[Symbol.asyncIterator]() {},
	})

	const createClient = () => {
		const create = sinon.stub().resolves(createAsyncIterable())
		return {
			client: {
				chat: {
					completions: {
						create,
					},
				},
			},
			create,
		}
	}

	const createModelInfo = (maxTokens: number): ModelInfo => ({
		maxTokens,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
	})

	const createThinkingModelInfo = (maxTokens: number): ModelInfo => ({
		...createModelInfo(maxTokens),
		thinkingConfig: { maxBudget: 128_000 },
	})

	it("adds cache control for Vercel models marked as prompt-cache capable", async () => {
		const { client, create } = createClient()

		await createVercelAIGatewayStream(
			client as any,
			"system prompt",
			[{ role: "user", content: "hello" }] as any,
			{
				id: "alibaba/qwen3.6-plus",
				info: {
					...createModelInfo(65_536),
					supportsPromptCache: true,
				},
			},
			"none",
			8192,
		)

		const payload = create.firstCall.args[0] as any
		payload.messages[0].content[0].cache_control.should.deepEqual({ type: "ephemeral" })
		payload.messages[1].content[0].cache_control.should.deepEqual({ type: "ephemeral" })
	})

	it("disables include_reasoning for Qwen models when reasoning effort is none", async () => {
		const { client, create } = createClient()

		await createVercelAIGatewayStream(
			client as any,
			"system prompt",
			[{ role: "user", content: "hello" }] as any,
			{
				id: "alibaba/qwen3.6-plus",
				info: createModelInfo(65_536),
			},
			"none",
			8192,
		)

		const payload = create.firstCall.args[0] as any
		payload.should.have.property("include_reasoning", false)
		payload.should.not.have.property("reasoning")
	})

	it("preserves budgeted reasoning when effort is none but a thinking budget is configured", async () => {
		const { client, create } = createClient()

		await createVercelAIGatewayStream(
			client as any,
			"system prompt",
			[{ role: "user", content: "hello" }] as any,
			{
				id: "anthropic/claude-sonnet-4.5",
				info: createThinkingModelInfo(65_536),
			},
			"none",
			8192,
		)

		const payload = create.firstCall.args[0] as any
		payload.should.have.property("include_reasoning", true)
		payload.reasoning.should.deepEqual({ max_tokens: 8192 })
	})
})
