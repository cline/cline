import { getProviderCollectionSync } from "@cline/llms"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import "should"
import should from "should"
import { adaptSdkModelInfo } from "@/sdk/model-catalog/shape-adapter"
import { AnthropicHandler } from "../anthropic"

// Base-model `ModelInfo` from the SDK catalog. The Anthropic handler
// resolves ids against the same catalog, so the info returned by
// `getModel()` must equal this for the corresponding base id.
const sdkAnthropic = getProviderCollectionSync("anthropic")
function sdkInfo(modelId: string) {
	const raw = sdkAnthropic?.models[modelId]
	if (!raw) {
		throw new Error(`SDK anthropic catalog missing ${modelId}`)
	}
	return adaptSdkModelInfo(raw)
}

describe("AnthropicHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: readonly unknown[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	describe("getModel", () => {
		it("resolves a base id straight from the SDK catalog", () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-opus-4-7",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-7")
			result.info.should.deepEqual(sdkInfo("claude-opus-4-7"))
		})

		it("strips a legacy `:1m` suffix off ids written by older extension versions", () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-opus-4-7:1m",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-7")
			result.info.should.deepEqual(sdkInfo("claude-opus-4-7"))
		})

		it("strips a legacy `:fast` suffix off ids written by older extension versions", () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-opus-4-6:fast",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-6")
			result.info.should.deepEqual(sdkInfo("claude-opus-4-6"))
		})

		it("strips a combined `:1m:fast` suffix off ids written by older extension versions", () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-opus-4-6:1m:fast",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-6")
			result.info.should.deepEqual(sdkInfo("claude-opus-4-6"))
		})
	})

	describe("createMessage", () => {
		it("sends a single Anthropic Messages request without per-request betas", async () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-opus-4-7",
				reasoningEffort: "high",
			})

			const standardCreate = sinon.stub().resolves(createAsyncIterable())
			const betaCreate = sinon.stub().resolves(createAsyncIterable())

			sinon.stub(handler as unknown as { ensureClient: () => unknown }, "ensureClient").returns({
				messages: { create: standardCreate },
				beta: { messages: { _client: {}, create: betaCreate } },
			})

			for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "Hello" }])) {
			}

			sinon.assert.notCalled(betaCreate)
			sinon.assert.calledOnce(standardCreate)
			const requestBody = standardCreate.firstCall.args[0] as Record<string, any>
			should(standardCreate.firstCall.args[1]).equal(undefined)
			requestBody.model.should.equal("claude-opus-4-7")
			requestBody.stream.should.equal(true)
		})

		it("uses adaptive thinking and output_config for Claude Opus adaptive models", async () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-opus-4-7",
				reasoningEffort: "xhigh",
			})

			const standardCreate = sinon.stub().resolves(createAsyncIterable())

			sinon.stub(handler as unknown as { ensureClient: () => unknown }, "ensureClient").returns({
				messages: { create: standardCreate },
				beta: { messages: { _client: {}, create: sinon.stub().resolves(createAsyncIterable()) } },
			})

			for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "Hello" }])) {
			}

			sinon.assert.calledOnce(standardCreate)
			const requestBody = standardCreate.firstCall.args[0] as Record<string, any>
			requestBody.thinking.should.deepEqual({ type: "adaptive" })
			requestBody.output_config.should.deepEqual({ effort: "xhigh" })
			should(requestBody.temperature).equal(undefined)
		})
	})
})
