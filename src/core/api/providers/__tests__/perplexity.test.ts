import "should"
import { perplexityDefaultModelId, perplexityModels } from "@shared/api"
import * as net from "@/shared/net"
import sinon from "sinon"
import { version as extensionVersion } from "../../../../../package.json"
import { PerplexityHandler } from "../perplexity"

describe("PerplexityHandler", () => {
	const originalEnv = { ...process.env }

	afterEach(() => {
		sinon.restore()
		process.env = { ...originalEnv }
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	it("should throw when no API key is configured (settings or env vars)", async () => {
		delete process.env.PERPLEXITY_API_KEY
		delete process.env.PPLX_API_KEY

		const handler = new PerplexityHandler({})
		;(() => (handler as any).ensureClient()).should.throw("Perplexity API key is required")
	})

	it("should fall back to PERPLEXITY_API_KEY env var when no key is set in settings", async () => {
		delete process.env.PPLX_API_KEY
		process.env.PERPLEXITY_API_KEY = "env-test-key"

		const handler = new PerplexityHandler({})
		const client = (handler as any).ensureClient()
		client.should.not.be.undefined()
	})

	it("should fall back to PPLX_API_KEY env var as a secondary fallback", async () => {
		delete process.env.PERPLEXITY_API_KEY
		process.env.PPLX_API_KEY = "pplx-test-key"

		const handler = new PerplexityHandler({})
		const client = (handler as any).ensureClient()
		client.should.not.be.undefined()
	})

	it("should fall back to PPLX_API_KEY when PERPLEXITY_API_KEY is empty", async () => {
		process.env.PERPLEXITY_API_KEY = ""
		process.env.PPLX_API_KEY = "pplx-test-key"

		const handler = new PerplexityHandler({})
		const client = (handler as any).ensureClient()
		client.should.not.be.undefined()
	})

	it("should add the Perplexity integration attribution header to outbound requests", () => {
		const createOpenAIClientStub = sinon.stub(net, "createOpenAIClient").returns({} as any)
		const handler = new PerplexityHandler({ perplexityApiKey: "test-key" })

		;(handler as any).ensureClient()

		const headers = createOpenAIClientStub.firstCall.args[0].defaultHeaders as Record<string, string>
		headers["X-Pplx-Integration"].should.equal(`cline/${extensionVersion}`)
		headers["X-Pplx-Integration"].should.match(/^cline\//)
	})

	it("should default to openai/gpt-5.5 when no model id is provided", () => {
		const handler = new PerplexityHandler({ perplexityApiKey: "test-key" })
		const model = handler.getModel()
		model.id.should.equal(perplexityDefaultModelId)
		model.id.should.equal("openai/gpt-5.5")
		model.info.should.equal(perplexityModels[perplexityDefaultModelId])
	})

	it("should select the configured Agent API model when a valid id is provided", () => {
		const handler = new PerplexityHandler({
			perplexityApiKey: "test-key",
			perplexityModelId: "anthropic/claude-sonnet-4-6",
		})
		const model = handler.getModel()
		model.id.should.equal("anthropic/claude-sonnet-4-6")
		model.info.should.equal(perplexityModels["anthropic/claude-sonnet-4-6"])
	})

	it("should fall back to the default model when an unknown model id is provided", () => {
		const handler = new PerplexityHandler({
			perplexityApiKey: "test-key",
			perplexityModelId: "not-a-real-model",
		})
		const model = handler.getModel()
		model.id.should.equal(perplexityDefaultModelId)
	})

	it("should stream text and usage chunks from a chat completion response", async () => {
		const handler = new PerplexityHandler({
			perplexityApiKey: "test-key",
			perplexityModelId: "openai/gpt-5.5",
		})

		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{ choices: [{ delta: { content: "Hello " } }] },
							{ choices: [{ delta: { content: "world" } }] },
							{
								choices: [{}],
								usage: { prompt_tokens: 10, completion_tokens: 2 },
							},
						]),
					),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{ type: "text", text: "Hello " },
			{ type: "text", text: "world" },
			{ type: "usage", inputTokens: 10, outputTokens: 2 },
		])
	})

	it("should yield reasoning chunks (reasoning_content) before text when both are present", async () => {
		const handler = new PerplexityHandler({
			perplexityApiKey: "test-key",
			perplexityModelId: "anthropic/claude-opus-4-7",
		})

		const fakeClient = {
			chat: {
				completions: {
					create: sinon
						.stub()
						.resolves(
							createAsyncIterable([
								{ choices: [{ delta: { reasoning_content: "thinking...", content: "answer" } }] },
							]),
						),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{ type: "reasoning", reasoning: "thinking..." },
			{ type: "text", text: "answer" },
		])
	})

	it("should also accept the alternate `reasoning` field (Anthropic / Gemini / Grok style)", async () => {
		const handler = new PerplexityHandler({
			perplexityApiKey: "test-key",
			perplexityModelId: "anthropic/claude-sonnet-4-6",
		})

		const fakeClient = {
			chat: {
				completions: {
					create: sinon
						.stub()
						.resolves(createAsyncIterable([{ choices: [{ delta: { reasoning: "step one", content: "done" } }] }])),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{ type: "reasoning", reasoning: "step one" },
			{ type: "text", text: "done" },
		])
	})

	it("should omit temperature for reasoning-capable models", async () => {
		const handler = new PerplexityHandler({
			perplexityApiKey: "test-key",
			perplexityModelId: "anthropic/claude-opus-4-7",
		})

		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(createAsyncIterable()),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		for await (const _ of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			// no-op
		}

		const request = fakeClient.chat.completions.create.firstCall.args[0]
		request.should.not.have.property("temperature")
	})

	it("should set temperature=0 for non-reasoning models", async () => {
		const handler = new PerplexityHandler({
			perplexityApiKey: "test-key",
			perplexityModelId: "openai/gpt-5.5",
		})

		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(createAsyncIterable()),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		for await (const _ of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			// no-op
		}

		const request = fakeClient.chat.completions.create.firstCall.args[0]
		request.temperature.should.equal(0)
	})

	it("should propagate errors from the upstream client", async () => {
		const handler = new PerplexityHandler({
			perplexityApiKey: "test-key",
			perplexityModelId: "openai/gpt-5.5",
		})

		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().rejects(new Error("upstream 401")),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		let caught: Error | undefined
		try {
			for await (const _ of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				// no-op
			}
		} catch (err) {
			caught = err as Error
		}
		// Wrapped by @withRetry, but the underlying message should still be present.
		;(caught !== undefined).should.be.true()
		String(caught?.message).should.match(/upstream 401/)
	})
})
