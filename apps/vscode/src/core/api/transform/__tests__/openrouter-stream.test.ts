import { describe, it } from "mocha"
import "should"
import type { ModelInfo } from "@shared/api"
import sinon from "sinon"
import { createOpenRouterStream } from "../openrouter-stream"

describe("createOpenRouterStream", () => {
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

	it("caps Gemini Flash OpenRouter requests to 8192 max_tokens", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "google/gemini-2.5-flash",
			info: createModelInfo(65_536),
		})

		const payload = create.firstCall.args[0] as Record<string, any>
		payload.should.have.property("max_tokens", 8_192)
	})

	it("keeps lower Gemini Flash max_tokens values when already below 8192", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "google/gemini-2.5-flash",
			info: createModelInfo(4_096),
		})

		const payload = create.firstCall.args[0] as Record<string, any>
		payload.should.have.property("max_tokens", 4_096)
	})

	it("does not send max_tokens for non-Gemini models", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "anthropic/claude-sonnet-4.5",
			info: createModelInfo(64_000),
		})

		const payload = create.firstCall.args[0] as any
		payload.should.not.have.property("max_tokens")
	})

	it("does not send max_tokens for non-Flash Gemini models", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "google/gemini-2.5-pro",
			info: createModelInfo(65_536),
		})

		const payload = create.firstCall.args[0] as any
		payload.should.not.have.property("max_tokens")
	})

	it("adds cache_control blocks for Qwen models that require explicit OpenRouter caching", async () => {
		for (const modelId of ["qwen/qwen3.6-plus", "qwen/qwen3.7-max"]) {
			const { client, create } = createClient()

			await createOpenRouterStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
				id: modelId,
				info: createModelInfo(65_536),
			})

			const payload = create.firstCall.args[0] as any
			payload.messages[0].content[0].cache_control.should.deepEqual({ type: "ephemeral" })
			payload.messages[1].content[0].cache_control.should.deepEqual({ type: "ephemeral" })
		}
	})

	it("uses adaptive reasoning with verbosity for Claude Opus adaptive models", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(
			client as any,
			"system prompt",
			[{ role: "user", content: "hello" }] as any,
			{
				id: "anthropic/claude-opus-4.6",
				info: createModelInfo(64_000),
			},
			"xhigh",
		)

		const payload = create.firstCall.args[0] as any
		payload.should.have.property("reasoning")
		payload.reasoning.should.deepEqual({ enabled: true })
		payload.should.have.property("verbosity", "xhigh")
		should(payload.temperature).equal(undefined)
		should(payload.top_p).equal(undefined)
	})

	it("includes reasoning for Claude budget-based reasoning models", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(
			client as any,
			"system prompt",
			[{ role: "user", content: "hello" }] as any,
			{
				id: "anthropic/claude-sonnet-4.5",
				info: createModelInfo(64_000),
			},
			undefined,
			16_384,
		)

		const payload = create.firstCall.args[0] as any
		payload.should.have.property("include_reasoning", true)
		payload.reasoning.should.deepEqual({ max_tokens: 16_384 })
		should(payload.temperature).equal(undefined)
	})

	it("sends reasoning effort instead of token budgets for supported OpenRouter/Cline model families", async () => {
		for (const modelId of [
			"zai/glm-5.2",
			"z-ai/glm-5.2",
			"moonshotai/kimi-k2-thinking",
			"qwen/qwen3.7-max",
			"deepseek/deepseek-r1",
		]) {
			const { client, create } = createClient()

			await createOpenRouterStream(
				client as any,
				"system prompt",
				[{ role: "user", content: "hello" }] as any,
				{
					id: modelId,
					info: { ...createModelInfo(131_072), thinkingConfig: { maxBudget: 16_384 } },
				},
				"high",
				16_384,
			)

			const payload = create.firstCall.args[0] as any
			payload.should.have.property("include_reasoning", true)
			payload.reasoning.should.deepEqual({ effort: "high" })
		}
	})

	it("does not send reasoning effort for ClinePass requests when unset", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(client as any, "system prompt", [{ role: "user", content: "hello" }] as any, {
			id: "cline-pass/glm-5.2",
			info: { ...createModelInfo(131_072), supportsReasoning: true },
		})

		const payload = create.firstCall.args[0] as any
		payload.should.have.property("include_reasoning", true)
		payload.should.not.have.property("reasoning")
	})

	it("sends the selected reasoning effort for ClinePass requests", async () => {
		const { client, create } = createClient()

		await createOpenRouterStream(
			client as any,
			"system prompt",
			[{ role: "user", content: "hello" }] as any,
			{
				id: "cline-pass/glm-5.1",
				info: { ...createModelInfo(131_072), supportsReasoning: true },
			},
			"high",
		)

		const payload = create.firstCall.args[0] as any
		payload.should.have.property("include_reasoning", true)
		payload.reasoning.should.deepEqual({ effort: "high" })
	})
})
