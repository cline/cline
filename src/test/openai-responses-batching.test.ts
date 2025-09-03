// Helper import for unit tests of the batching function
import { batchResponseInputByImages, OpenAiHandler } from "@api/providers/openai"
import { describe, it } from "mocha"
import * as should from "should"

// Proxyquire for provider-level tests to stub OpenAI SDK and limiter
// eslint-disable-next-line @typescript-eslint/no-var-requires
// proxyquire removed; using direct client injection

type ResponseInput = any

function countInputImages(input: ResponseInput): number {
	let count = 0
	for (const item of input || []) {
		if (item?.type === "message" && Array.isArray(item.content)) {
			for (const part of item.content) {
				if (part?.type === "input_image") count++
			}
		}
	}
	return count
}

function makeStream(chunks: any[]): AsyncIterable<any> {
	return {
		[Symbol.asyncIterator]() {
			let i = 0
			return {
				async next() {
					if (i < chunks.length) {
						return { value: chunks[i++], done: false }
					}
					return { value: undefined, done: true }
				},
			}
		},
	} as any
}

describe("OpenAI Responses batching by image count", () => {
	describe("batchResponseInputByImages helper", () => {
		it("0 images → 1 batch unchanged", () => {
			const input: ResponseInput = [
				{
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "hello" }],
				},
				{
					type: "function_call",
					name: "noop",
					arguments: "{}",
					call_id: "abc",
				},
			]

			const { inputs, totalImages } = batchResponseInputByImages(input, 10)
			should.equal(totalImages, 0)
			should.equal(inputs.length, 1)
			should.deepEqual(inputs[0], input)
		})

		it("1–10 images → 1 batch unchanged", () => {
			const images = Array.from({ length: 5 }).map(() => ({
				type: "input_image",
				image_url: "data:image/png;base64,AAA",
				detail: "auto",
			}))
			const input: ResponseInput = [
				{
					type: "message",
					role: "user",
					content: images,
				},
			]

			const { inputs, totalImages } = batchResponseInputByImages(input, 10)
			should.equal(totalImages, 5)
			should.equal(inputs.length, 1)
			should.deepEqual(inputs[0], input)
		})

		it("11 images → 2 batches (10 + 1)", () => {
			const images = Array.from({ length: 11 }).map(() => ({
				type: "input_image",
				image_url: "data:image/png;base64,AAA",
				detail: "auto",
			}))
			const input: ResponseInput = [
				{
					type: "message",
					role: "user",
					content: images,
				},
			]

			const { inputs, totalImages } = batchResponseInputByImages(input, 10)
			should.equal(totalImages, 11)
			should.equal(inputs.length, 2)
			should.equal(countInputImages(inputs[0]), 10)
			should.equal(countInputImages(inputs[1]), 1)
		})

		it("Mixed content: non-images preserved in all batches; empty messages pruned", () => {
			const input: ResponseInput = [
				{
					type: "message",
					role: "user",
					content: [
						{ type: "input_text", text: "A" },
						{ type: "input_image", image_url: "data:image/png;base64,1", detail: "auto" },
						{ type: "input_text", text: "B" },
						{ type: "input_image", image_url: "data:image/png;base64,2", detail: "auto" },
					],
				},
				// Message with only images
				{
					type: "message",
					role: "user",
					content: [
						{ type: "input_image", image_url: "data:image/png;base64,3", detail: "auto" },
						{ type: "input_image", image_url: "data:image/png;base64,4", detail: "auto" },
					],
				},
				// Function call entry must persist across batches
				{
					type: "function_call",
					name: "do_stuff",
					arguments: "{}",
					call_id: "cid-1",
				},
			]

			const { inputs, totalImages } = batchResponseInputByImages(input, 2)
			should.equal(totalImages, 4)
			should.equal(inputs.length, 2)

			// Batch 1 should contain first 2 images and all text parts; function_call present
			const b1 = inputs[0]
			should.equal(countInputImages(b1), 2)
			should.equal(
				b1.some(
					(e: any) => e?.type === "message" && e.content?.some((p: any) => p?.type === "input_text" && p.text === "A"),
				),
				true,
			)
			should.equal(
				b1.some((e: any) => e?.type === "function_call"),
				true,
			)

			// Batch 2 should contain last 2 images and all text parts; function_call present
			const b2 = inputs[1]
			should.equal(countInputImages(b2), 2)
			should.equal(
				b2.some(
					(e: any) => e?.type === "message" && e.content?.some((p: any) => p?.type === "input_text" && p.text === "B"),
				),
				true,
			)
			should.equal(
				b2.some((e: any) => e?.type === "function_call"),
				true,
			)

			// Ensure that the message which only had images is omitted in batches where none of its images fall in range.
			// With 2-per-batch and 2 images in that message, it should appear in exactly one of the batches.
			const appearances = inputs.filter((batch: any) =>
				batch.some(
					(e: any) =>
						e?.type === "message" &&
						Array.isArray(e.content) &&
						e.content.every((p: any) => p?.type === "input_image"),
				),
			).length
			should.equal(appearances, 1)
		})
	})

	describe("OpenAiHandler.createMessage batching integration (provider-level)", () => {
		it("Partitions >10 images into multiple responses.create calls; suppresses intermediate text; aggregates usage", async () => {
			const calls: any[] = []
			let callIndex = 0

			// Two streams: first is intermediate with some text (should be suppressed) and usage;
			// second is final with text (should surface) and usage.
			const streams = [
				makeStream([
					{ type: "response.output_text.delta", delta: "INTERMEDIATE_SHOULD_BE_SUPPRESSED" },
					{ response: { usage: { input_tokens: 100, output_tokens: 5 } } },
				]),
				makeStream([
					{ type: "response.output_text.delta", delta: "FINAL " },
					{ type: "response.output_text.delta", delta: "ANSWER" },
					{ response: { usage: { input_tokens: 50, output_tokens: 10 } } },
				]),
			]

			class MockOpenAI {
				responses: any
				constructor(_: any) {
					this.responses = {
						create: async (req: any) => {
							calls.push(req)
							const s = streams[callIndex++]
							return s
						},
					}
				}
			}
			class MockAzureOpenAI extends MockOpenAI {}

			const handler = new OpenAiHandler({
				openAiApiKey: "sk-test",
				openAiModelId: "gpt-5-mock",
			})
			;(handler as any).client = new MockOpenAI({})

			// Build Anthropic-style messages with 11 images
			const messages: any[] = [
				{
					role: "user",
					content: Array.from({ length: 11 }).map(() => ({
						type: "image",
						source: { media_type: "image/png", data: "AAA" },
					})),
				},
			]

			const system = "SYS"
			const gen = handler.createMessage(system, messages)

			let text = ""
			let lastUsage: any = null
			for await (const ev of gen as any) {
				if (ev.type === "text") text += ev.text
				if (ev.type === "usage") lastUsage = ev
			}

			// Should make 2 calls due to 11 images
			should.equal(calls.length, 2)

			// Instructions check
			should.ok(
				typeof calls[0].instructions === "string" &&
					calls[0].instructions.includes("Do NOT produce a final answer yet") &&
					calls[0].instructions.includes("ALL_IMAGES_PROVIDED"),
			)
			should.ok(
				typeof calls[1].instructions === "string" &&
					calls[1].instructions.includes("ALL_IMAGES_PROVIDED") &&
					calls[1].instructions.includes("Produce the final answer now"),
			)

			// Per-request image count
			should.ok(countInputImages(calls[0].input) <= 10)
			should.ok(countInputImages(calls[1].input) <= 10)
			should.equal(countInputImages(calls[0].input) + countInputImages(calls[1].input), 11)

			// Only final text surfaced
			should.equal(text, "FINAL ANSWER")

			// Aggregated usage from both streams
			should.exist(lastUsage)
			should.equal(lastUsage.inputTokens, 150)
			should.equal(lastUsage.outputTokens, 15)
		})
	})
})
