import { expect } from "chai"
import type { ClineMessage } from "../../ExtensionMessage"
import { enrichMessagesWithMetrics } from "../atif-converter"
import type { ClineStorageMessage } from "../content"

describe("ATIF Converter - Metrics Enrichment", () => {
	describe("enrichMessagesWithMetrics", () => {
		it("should enrich assistant messages with metrics from api_req_started messages", () => {
			// Setup: Create clineMessages with api_req_started containing metrics
			const clineMessages: ClineMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "text",
					text: "User task",
				},
				{
					ts: 2000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 100,
						tokensOut: 200,
						cacheWrites: 10,
						cacheReads: 20,
						cost: 0.05,
					}),
				},
				{
					ts: 3000,
					type: "say",
					say: "text",
					text: "Assistant response",
				},
			]

			// Setup: Create apiConversationHistory without metrics
			const apiConversationHistory: ClineStorageMessage[] = [
				{
					role: "user",
					content: "User task",
				},
				{
					role: "assistant",
					content: "Assistant response",
				},
			]

			// Act: Enrich messages with metrics
			const enriched = enrichMessagesWithMetrics(apiConversationHistory, clineMessages)

			// Assert: User message should not have metrics
			expect(enriched[0]).to.deep.equal({
				role: "user",
				content: "User task",
			})

			// Assert: Assistant message should have metrics
			expect(enriched[1]).to.deep.equal({
				role: "assistant",
				content: "Assistant response",
				metrics: {
					promptTokens: 100,
					completionTokens: 200,
					cachedTokens: 30, // 10 + 20
					totalCost: 0.05,
				},
			})
		})

		it("should handle multiple assistant messages with separate metrics", () => {
			const clineMessages: ClineMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 100,
						tokensOut: 200,
						cost: 0.05,
					}),
				},
				{
					ts: 2000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 150,
						tokensOut: 250,
						cost: 0.08,
					}),
				},
			]

			const apiConversationHistory: ClineStorageMessage[] = [
				{
					role: "user",
					content: "First question",
				},
				{
					role: "assistant",
					content: "First response",
				},
				{
					role: "user",
					content: "Second question",
				},
				{
					role: "assistant",
					content: "Second response",
				},
			]

			const enriched = enrichMessagesWithMetrics(apiConversationHistory, clineMessages)

			// First assistant message should have first set of metrics
			expect(enriched[1].metrics).to.deep.equal({
				promptTokens: 100,
				completionTokens: 200,
				cachedTokens: 0,
				totalCost: 0.05,
			})

			// Second assistant message should have second set of metrics
			expect(enriched[3].metrics).to.deep.equal({
				promptTokens: 150,
				completionTokens: 250,
				cachedTokens: 0,
				totalCost: 0.08,
			})
		})

		it("should handle missing cache metrics gracefully", () => {
			const clineMessages: ClineMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 100,
						tokensOut: 200,
						cost: 0.05,
						// No cacheWrites or cacheReads
					}),
				},
			]

			const apiConversationHistory: ClineStorageMessage[] = [
				{
					role: "user",
					content: "Question",
				},
				{
					role: "assistant",
					content: "Response",
				},
			]

			const enriched = enrichMessagesWithMetrics(apiConversationHistory, clineMessages)

			expect(enriched[1].metrics).to.deep.equal({
				promptTokens: 100,
				completionTokens: 200,
				cachedTokens: 0, // Should default to 0
				totalCost: 0.05,
			})
		})

		it("should handle malformed JSON in api_req_started messages", () => {
			const clineMessages: ClineMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "api_req_started",
					text: "not valid json {",
				},
			]

			const apiConversationHistory: ClineStorageMessage[] = [
				{
					role: "user",
					content: "Question",
				},
				{
					role: "assistant",
					content: "Response",
				},
			]

			const enriched = enrichMessagesWithMetrics(apiConversationHistory, clineMessages)

			// Assistant message should not have metrics when parsing fails
			expect(enriched[1]).to.deep.equal({
				role: "assistant",
				content: "Response",
			})
		})

		it("should handle empty arrays", () => {
			const enriched = enrichMessagesWithMetrics([], [])
			expect(enriched).to.deep.equal([])
		})

		it("should not modify original arrays", () => {
			const clineMessages: ClineMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 100,
						tokensOut: 200,
						cost: 0.05,
					}),
				},
			]

			const apiConversationHistory: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: "Response",
				},
			]

			const originalHistoryCopy = JSON.parse(JSON.stringify(apiConversationHistory))
			const originalClineMessagesCopy = JSON.parse(JSON.stringify(clineMessages))

			enrichMessagesWithMetrics(apiConversationHistory, clineMessages)

			// Original arrays should not be modified
			expect(apiConversationHistory).to.deep.equal(originalHistoryCopy)
			expect(clineMessages).to.deep.equal(originalClineMessagesCopy)
		})

		it("should skip assistant messages when no more metrics available", () => {
			const clineMessages: ClineMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 100,
						tokensOut: 200,
						cost: 0.05,
					}),
				},
			]

			const apiConversationHistory: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: "First response",
				},
				{
					role: "assistant",
					content: "Second response (no metrics)",
				},
			]

			const enriched = enrichMessagesWithMetrics(apiConversationHistory, clineMessages)

			// First assistant should have metrics
			expect(enriched[0].metrics).to.exist

			// Second assistant should not have metrics (no more api_req_started messages)
			expect(enriched[1].metrics).to.be.undefined
		})

		it("should handle api_req_started with missing required fields", () => {
			const clineMessages: ClineMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						// Missing tokensIn and tokensOut
						cost: 0.05,
					}),
				},
			]

			const apiConversationHistory: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: "Response",
				},
			]

			const enriched = enrichMessagesWithMetrics(apiConversationHistory, clineMessages)

			// Should not add metrics if tokensIn or tokensOut are missing
			expect(enriched[0]).to.deep.equal({
				role: "assistant",
				content: "Response",
			})
		})
	})
})
