import "should"
import { chutesDefaultModelId, chutesModels, openAiModelInfoSaneDefaults } from "@shared/api"
import { ChutesHandler } from "../chutes"

describe("ChutesHandler", () => {
	it("returns known catalog model metadata when model id is recognized", () => {
		const modelId = "deepseek-ai/DeepSeek-V3.2-TEE"
		const handler = new ChutesHandler({
			chutesApiKey: "test-api-key",
			apiModelId: modelId,
		})

		const model = handler.getModel()

		model.id.should.equal(modelId)
		model.info.should.deepEqual(chutesModels[modelId])
	})

	it("passes through an explicit unknown model id instead of silently falling back", () => {
		const unknownModelId = "some-org/Unknown-Model-TEE"
		const handler = new ChutesHandler({
			chutesApiKey: "test-api-key",
			apiModelId: unknownModelId,
		})

		const model = handler.getModel()

		model.id.should.equal(unknownModelId)
		model.info.should.deepEqual(openAiModelInfoSaneDefaults)
	})

	it("uses the default Chutes model when no model id is configured", () => {
		const handler = new ChutesHandler({
			chutesApiKey: "test-api-key",
		})

		const model = handler.getModel()

		model.id.should.equal(chutesDefaultModelId)
		model.info.should.deepEqual(chutesModels[chutesDefaultModelId])
	})

	// --- streaming usage accounting ---
	// Builds a handler whose OpenAI client streams the supplied chunks, bypassing the network.
	function handlerStreaming(chunks: any[]): ChutesHandler {
		const handler = new ChutesHandler({ chutesApiKey: "test-api-key", apiModelId: chutesDefaultModelId })
		;(handler as any).client = {
			chat: {
				completions: {
					create: async () =>
						(async function* () {
							for (const chunk of chunks) {
								yield chunk
							}
						})(),
				},
			},
		}
		return handler
	}

	async function collect(handler: ChutesHandler): Promise<any[]> {
		const out: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }] as any)) {
			out.push(chunk)
		}
		return out
	}

	it("emits a single usage chunk with the final totals when usage is attached to every chunk", async () => {
		// Chutes' gateway forces continuous_usage_stats, so each streamed chunk carries a
		// cumulative usage object. The handler must NOT sum them.
		const out = await collect(
			handlerStreaming([
				{ choices: [{ delta: { content: "Hel" } }], usage: { prompt_tokens: 10, completion_tokens: 1 } },
				{ choices: [{ delta: { content: "lo" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
				{ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 3 } },
			]),
		)

		const text = out
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("")
		const usage = out.filter((c) => c.type === "usage")

		text.should.equal("Hello")
		usage.length.should.equal(1) // exactly one, not one-per-chunk
		usage[0].inputTokens.should.equal(10) // final snapshot, NOT 30 (summed)
		usage[0].outputTokens.should.equal(3)
	})

	it("omits cacheReadTokens when no cached tokens were used", async () => {
		const out = await collect(
			handlerStreaming([
				{
					choices: [{ delta: { content: "x" } }],
					usage: { prompt_tokens: 5, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } },
				},
			]),
		)

		const usage = out.find((c) => c.type === "usage")
		usage.should.not.have.property("cacheReadTokens")
	})

	it("reports cacheReadTokens when cached tokens were used", async () => {
		const out = await collect(
			handlerStreaming([
				{
					choices: [{ delta: { content: "x" } }],
					usage: { prompt_tokens: 5, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 3 } },
				},
			]),
		)

		const usage = out.find((c) => c.type === "usage")
		usage.cacheReadTokens.should.equal(3)
	})
})
