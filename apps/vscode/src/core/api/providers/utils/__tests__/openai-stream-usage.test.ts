import { expect } from "chai"
import { OpenAiStreamUsageTracker } from "../openai-stream-usage"

describe("OpenAiStreamUsageTracker", () => {
	it("keeps only the final usage values from a streaming response", () => {
		const tracker = new OpenAiStreamUsageTracker()

		tracker.record({ prompt_tokens: 100, completion_tokens: 1 })
		tracker.record({ prompt_tokens: 100, completion_tokens: 2 })

		expect(tracker.getUsageChunk()).to.deep.equal({
			type: "usage",
			inputTokens: 100,
			outputTokens: 2,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		})
	})

	it("maps cache token details from the final usage values", () => {
		const tracker = new OpenAiStreamUsageTracker()

		tracker.record({
			prompt_tokens: 100,
			completion_tokens: 2,
			prompt_tokens_details: { cached_tokens: 40 },
			prompt_cache_miss_tokens: 10,
		})

		expect(tracker.getUsageChunk()).to.deep.equal({
			type: "usage",
			inputTokens: 100,
			outputTokens: 2,
			cacheReadTokens: 40,
			cacheWriteTokens: 10,
		})
	})

	it("omits usage when the stream never reported usage", () => {
		const tracker = new OpenAiStreamUsageTracker()

		expect(tracker.getUsageChunk()).to.equal(undefined)
	})
})
