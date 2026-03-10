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

	it("should emit unique tool call IDs when multiple function calls share one responseId", async () => {
		const handler = new GeminiHandler({
			geminiApiKey: "test-api-key",
		})

		const fakeClient = {
			models: {
				generateContentStream: sinon.stub().resolves(
					createAsyncIterable([
						{
							responseId: "resp_1",
							candidates: [
								{
									content: {
										parts: [
											{
												functionCall: {
													name: "read_file",
													args: { path: ".nvmrc" },
												},
											},
										],
									},
								},
							],
						},
						{
							responseId: "resp_1",
							candidates: [
								{
									content: {
										parts: [
											{
												functionCall: {
													name: "read_file",
													args: { path: ".gitattributes" },
												},
											},
										],
									},
								},
							],
						},
					]),
				),
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		const tools = [{ name: "read_file", description: "read file", parameters: { type: "OBJECT" } }] as any
		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
			if (chunk.type === "tool_calls") {
				chunks.push(chunk)
			}
		}

		chunks.should.have.length(2)
		chunks[0].tool_call.function.id.should.not.equal(chunks[1].tool_call.function.id)
		chunks[0].tool_call.call_id.should.equal(chunks[0].tool_call.function.id)
		chunks[1].tool_call.call_id.should.equal(chunks[1].tool_call.function.id)
		JSON.parse(chunks[0].tool_call.function.arguments).path.should.equal(".nvmrc")
		JSON.parse(chunks[1].tool_call.function.arguments).path.should.equal(".gitattributes")
	})

	it("should preserve Gemini-provided functionCall.id when present", async () => {
		const handler = new GeminiHandler({
			geminiApiKey: "test-api-key",
		})

		const fakeClient = {
			models: {
				generateContentStream: sinon.stub().resolves(
					createAsyncIterable([
						{
							responseId: "resp_2",
							candidates: [
								{
									content: {
										parts: [
											{
												functionCall: {
													id: "call_alpha",
													name: "read_file",
													args: { path: ".nvmrc" },
												},
											},
										],
									},
								},
							],
						},
					]),
				),
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

		const tools = [{ name: "read_file", description: "read file", parameters: { type: "OBJECT" } }] as any
		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
			if (chunk.type === "tool_calls") {
				chunks.push(chunk)
			}
		}

		chunks.should.have.length(1)
		chunks[0].tool_call.function.id.should.equal("call_alpha")
		chunks[0].tool_call.call_id.should.equal("call_alpha")
		JSON.parse(chunks[0].tool_call.function.arguments).path.should.equal(".nvmrc")
	})
})
