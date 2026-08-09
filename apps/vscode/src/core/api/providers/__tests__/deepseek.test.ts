import "should"
import type OpenAI from "openai"
import { DEEPSEEK_DEFAULT_TIMEOUT_MS, DeepSeekHandler } from "../deepseek"

describe("DeepSeekHandler", () => {
	const getClient = (handler: DeepSeekHandler): OpenAI =>
		(handler as unknown as { ensureClient: () => OpenAI }).ensureClient()

	it("caps time-to-first-response with a default timeout instead of the openai SDK's 10 minutes", () => {
		const handler = new DeepSeekHandler({ deepSeekApiKey: "test-api-key" })

		getClient(handler).timeout.should.equal(DEEPSEEK_DEFAULT_TIMEOUT_MS)
	})

	it("honors a user-configured request timeout", () => {
		const handler = new DeepSeekHandler({
			deepSeekApiKey: "test-api-key",
			requestTimeoutMs: 300_000,
		})

		getClient(handler).timeout.should.equal(300_000)
	})
})
