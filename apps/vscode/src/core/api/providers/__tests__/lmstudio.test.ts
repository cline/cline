import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import * as net from "@/shared/net"
import { LmStudioHandler } from "../lmstudio"

describe("LmStudioHandler", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("uses the configured LM Studio API key when creating the OpenAI-compatible client", () => {
		const createOpenAIClientStub = sandbox.stub(net, "createOpenAIClient").returns({} as any)
		const handler = new LmStudioHandler({
			lmStudioBaseUrl: "http://localhost:1234",
			lmStudioApiKey: "lmstudio-secret",
		} as any)

		;(handler as any).ensureClient()

		sinon.assert.calledOnce(createOpenAIClientStub)
		expect(createOpenAIClientStub.firstCall.args[0]).to.include({
			apiKey: "lmstudio-secret",
			baseURL: "http://localhost:1234/api/v0",
		})
	})
})
