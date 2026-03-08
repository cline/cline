import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import "should"
import { ANTHROPIC_FAST_MODE_BETA, anthropicModels } from "@shared/api"
import { AnthropicHandler } from "../anthropic"

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
		it("should return the fast mode model when configured", () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-opus-4-6:fast",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-6:fast")
			result.info.should.deepEqual(anthropicModels["claude-opus-4-6:fast"])
		})

		it("should return the 1m fast mode model when configured", () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-opus-4-6:1m:fast",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-6:1m:fast")
			result.info.should.deepEqual(anthropicModels["claude-opus-4-6:1m:fast"])
		})
	})

	describe("createMessage", () => {
		it("should route fast mode requests through the beta messages API", async () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-opus-4-6:fast",
			})

			const standardCreate = sinon.stub().resolves(createAsyncIterable())
			const betaCreate = sinon.stub().callsFake(function (this: { _client?: object }, _params: unknown) {
				should.exist(this._client)
				return Promise.resolve(createAsyncIterable())
			})

			sinon.stub(handler as unknown as { ensureClient: () => unknown }, "ensureClient").returns({
				messages: {
					create: standardCreate,
				},
				beta: {
					messages: {
						_client: {},
						create: betaCreate,
					},
				},
			})

			for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "Hello" }])) {
			}

			sinon.assert.notCalled(standardCreate)
			sinon.assert.calledOnce(betaCreate)
			sinon.assert.calledWithMatch(betaCreate, {
				model: "claude-opus-4-6",
				betas: [ANTHROPIC_FAST_MODE_BETA],
				speed: "fast",
				stream: true,
			})
		})

		it("should include the 1m beta when routing 1m fast mode requests through the beta messages API", async () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-opus-4-6:1m:fast",
			})

			const standardCreate = sinon.stub().resolves(createAsyncIterable())
			const betaCreate = sinon.stub().callsFake(function (this: { _client?: object }, _params: unknown) {
				should.exist(this._client)
				return Promise.resolve(createAsyncIterable())
			})

			sinon.stub(handler as unknown as { ensureClient: () => unknown }, "ensureClient").returns({
				messages: {
					create: standardCreate,
				},
				beta: {
					messages: {
						_client: {},
						create: betaCreate,
					},
				},
			})

			for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "Hello" }])) {
			}

			sinon.assert.notCalled(standardCreate)
			sinon.assert.calledOnce(betaCreate)
			sinon.assert.calledWithMatch(betaCreate, {
				model: "claude-opus-4-6",
				betas: [ANTHROPIC_FAST_MODE_BETA, "context-1m-2025-08-07"],
				speed: "fast",
				stream: true,
			})
		})
	})
})
