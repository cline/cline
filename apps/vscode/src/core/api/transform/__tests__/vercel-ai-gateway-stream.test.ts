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

	const createModelInfo = (supportsPromptCache: boolean): ModelInfo => ({
		maxTokens: 8_192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache,
	})

	it("adds cache_control blocks when the model reports supportsPromptCache", async () => {
		const { client, create } = createClient()

		await createVercelAIGatewayStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "anthropic/claude-sonnet-4.5",
			info: createModelInfo(true),
		})

		const payload = create.firstCall.args[0] as any
		payload.messages[0].content[0].cache_control.should.deepEqual({ type: "ephemeral" })
		payload.messages[1].content[0].cache_control.should.deepEqual({ type: "ephemeral" })
	})

	it("adds cache_control blocks for non-anthropic cache-capable models", async () => {
		const { client, create } = createClient()

		await createVercelAIGatewayStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "zai/glm-4.6",
			info: createModelInfo(true),
		})

		const payload = create.firstCall.args[0] as any
		payload.messages[0].content[0].cache_control.should.deepEqual({ type: "ephemeral" })
		payload.messages[1].content[0].cache_control.should.deepEqual({ type: "ephemeral" })
	})

	it("adds cache_control blocks for Anthropic models even when the flag is unset", async () => {
		// Guards against registry pricing data being missing or stale for an Anthropic model.
		const { client, create } = createClient()

		await createVercelAIGatewayStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "anthropic/claude-sonnet-4.5",
			info: createModelInfo(false),
		})

		const payload = create.firstCall.args[0] as any
		payload.messages[0].content[0].cache_control.should.deepEqual({ type: "ephemeral" })
	})

	it("adds cache_control blocks for MiniMax models even without the flag", async () => {
		const { client, create } = createClient()

		await createVercelAIGatewayStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "minimax/minimax-m2",
			info: createModelInfo(false),
		})

		const payload = create.firstCall.args[0] as any
		payload.messages[0].content[0].cache_control.should.deepEqual({ type: "ephemeral" })
	})

	it("does not add cache_control blocks for models without prompt cache support", async () => {
		const { client, create } = createClient()

		await createVercelAIGatewayStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "openai/gpt-4o",
			info: createModelInfo(false),
		})

		const payload = create.firstCall.args[0] as any
		payload.messages[0].content.should.be.a.String()
	})
})
