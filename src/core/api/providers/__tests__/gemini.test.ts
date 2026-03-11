import "should"
import sinon from "sinon"
import { GeminiHandler } from "../gemini"

describe("GeminiHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	it("caps maxOutputTokens to 8192 for Flash models", async () => {
		const handler = new GeminiHandler({
			geminiApiKey: "test-api-key",
			apiModelId: "gemini-2.5-flash",
		})

		const generateContentStream = sinon.stub().resolves(
			createAsyncIterable([
				{
					responseId: "resp-1",
					usageMetadata: {
						promptTokenCount: 10,
						candidatesTokenCount: 20,
						cachedContentTokenCount: 0,
						thoughtsTokenCount: 0,
					},
				},
			]),
		)
		sinon.stub(handler as any, "ensureClient").returns({
			models: { generateContentStream },
		} as any)

		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }] as any)) {
			// Consume stream to trigger request execution.
		}

		const requestArgs = generateContentStream.firstCall.args[0] as Record<string, any>
		requestArgs.config.should.have.property("maxOutputTokens", 8_192)
	})

	it("does not set maxOutputTokens for non-Flash models", async () => {
		const handler = new GeminiHandler({
			geminiApiKey: "test-api-key",
			apiModelId: "gemini-2.5-pro",
		})

		const generateContentStream = sinon.stub().resolves(
			createAsyncIterable([
				{
					responseId: "resp-2",
					usageMetadata: {
						promptTokenCount: 10,
						candidatesTokenCount: 20,
						cachedContentTokenCount: 0,
						thoughtsTokenCount: 0,
					},
				},
			]),
		)
		sinon.stub(handler as any, "ensureClient").returns({
			models: { generateContentStream },
		} as any)

		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }] as any)) {
			// Consume stream to trigger request execution.
		}

		const requestArgs = generateContentStream.firstCall.args[0] as Record<string, any>
		requestArgs.config.should.not.have.property("maxOutputTokens")
	})
})
