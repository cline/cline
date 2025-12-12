import { expect } from "chai"
import sinon from "sinon"
import { OpenAiNativeHandler } from "../openai-native"

const createAsyncIterable = (data: any[] = []) => {
	return {
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	}
}

describe("OpenAiNativeHandler (Responses API)", () => {
	it("sends reasoning.effort=xhigh when configured", async () => {
		const fakeClient = {
			responses: {
				create: sinon.stub().resolves(createAsyncIterable([])),
			},
		}

		const handler = new OpenAiNativeHandler({
			openAiNativeApiKey: "test-api-key",
			apiModelId: "gpt-5.1-codex",
			reasoningEffort: "xhigh",
		})

		sinon.stub(handler, "ensureClient" as any).returns(fakeClient)

		const tools = [
			{
				type: "function",
				function: {
					name: "noop",
					description: "noop",
					parameters: { type: "object", properties: {} },
					strict: true,
				},
			},
		] as any

		for await (const _ of handler.createMessage("system", [], tools)) {
		}

		sinon.assert.calledOnce(fakeClient.responses.create)
		const callArgs = fakeClient.responses.create.getCall(0).args[0]
		expect(callArgs.reasoning?.effort).to.equal("xhigh")
	})
})

