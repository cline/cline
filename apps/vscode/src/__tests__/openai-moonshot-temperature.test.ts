import "should"
import { moonshotModels, openAiModelInfoSaneDefaults } from "@shared/api"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { OpenAiHandler } from "../core/api/providers/openai"

/**
 * Regression tests for issue #10544:
 *   "Moonshot Kimi K2.6 fails via OpenAI Compatible because Cline sends
 *    unsupported temperature"
 *
 * Moonshot's kimi-k2.6 enforces a fixed `temperature` on the server side and
 * returns a 400 error for any other value (including undefined). When a user
 * reaches this model through the generic OpenAI Compatible provider, Cline
 * must force the temperature to the value declared in `moonshotModels`
 * (`api.ts` is the single source of truth), regardless of user-supplied
 * config or baseUrl.
 */
describe("OpenAiHandler - kimi-k2.6 temperature enforcement", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	/**
	 * Builds an OpenAiHandler whose `ensureClient` is stubbed to a fake client
	 * so we can capture the outgoing chat.completions.create payload.
	 */
	const buildHandlerWithFakeClient = (options: ConstructorParameters<typeof OpenAiHandler>[0]) => {
		const handler = new OpenAiHandler(options)
		const createStub = sinon.stub().resolves(createAsyncIterable([]))
		const fakeClient = {
			chat: {
				completions: {
					create: createStub,
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)
		return { handler, createStub }
	}

	const drain = async (handler: OpenAiHandler) => {
		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			// drain stream so @withRetry() resolves cleanly
		}
	}

	it("should enforce the kimi-k2.6 temperature declared in moonshotModels (fixes #10544)", async () => {
		const { handler, createStub } = buildHandlerWithFakeClient({
			openAiApiKey: "test-api-key",
			openAiBaseUrl: "https://api.moonshot.ai/v1",
			openAiModelId: "kimi-k2.6",
		})

		await drain(handler)

		const payload = createStub.firstCall.args[0]
		// Assert the payload matches the single source of truth in api.ts,
		// so a future metadata change (e.g. Moonshot relaxing the requirement)
		// automatically propagates without touching provider code.
		payload.temperature.should.equal(moonshotModels["kimi-k2.6"].temperature)
	})

	it("should override user-configured temperature with the moonshotModels value for kimi-k2.6", async () => {
		const { handler, createStub } = buildHandlerWithFakeClient({
			openAiApiKey: "test-api-key",
			openAiBaseUrl: "https://api.moonshot.ai/v1",
			openAiModelId: "kimi-k2.6",
			// User tries to set a custom temperature — server would reject it.
			openAiModelInfo: {
				...openAiModelInfoSaneDefaults,
				temperature: 0.5,
			},
		})

		await drain(handler)

		const payload = createStub.firstCall.args[0]
		payload.temperature.should.equal(moonshotModels["kimi-k2.6"].temperature)
	})

	it("should enforce the moonshotModels temperature for kimi-k2.6 even through a proxy/mirror", async () => {
		const { handler, createStub } = buildHandlerWithFakeClient({
			openAiApiKey: "test-api-key",
			// User routes Moonshot through a self-hosted gateway — enforcement
			// must still apply because the upstream Moonshot API rejects anything
			// other than the declared temperature.
			openAiBaseUrl: "https://gateway.example.com/v1",
			openAiModelId: "kimi-k2.6",
			openAiModelInfo: {
				...openAiModelInfoSaneDefaults,
				temperature: 0.3,
			},
		})

		await drain(handler)

		const payload = createStub.firstCall.args[0]
		payload.temperature.should.equal(moonshotModels["kimi-k2.6"].temperature)
	})

	it("should NOT touch temperature for other Kimi models (scope is limited to kimi-k2.6)", async () => {
		const { handler, createStub } = buildHandlerWithFakeClient({
			openAiApiKey: "test-api-key",
			openAiBaseUrl: "https://api.moonshot.ai/v1",
			openAiModelId: "kimi-k2.5",
			openAiModelInfo: {
				...openAiModelInfoSaneDefaults,
				temperature: 0.7,
			},
		})

		await drain(handler)

		const payload = createStub.firstCall.args[0]
		// Other models remain user-configurable.
		payload.temperature.should.equal(0.7)
	})

	it("should preserve legacy behavior: user temperature=0 → undefined for non-kimi-k2.6 models", async () => {
		const { handler, createStub } = buildHandlerWithFakeClient({
			openAiApiKey: "test-api-key",
			openAiBaseUrl: "https://api.example.com/v1",
			openAiModelId: "gpt-4o-mini",
			openAiModelInfo: {
				...openAiModelInfoSaneDefaults,
				temperature: 0,
			},
		})

		await drain(handler)

		const payload = createStub.firstCall.args[0]
		should(payload.temperature).be.undefined()
	})
})
