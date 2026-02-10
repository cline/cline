import { MinimaxHandler } from "@core/api/providers/minimax"
import { expect } from "chai"
import sinon from "sinon"
import type { ClineStorageMessage } from "@/shared/messages/content"

const fakeClient = {
	messages: {
		create: sinon.stub(),
	},
}

const createAsyncIterable = (data: any[] = []) => {
	return {
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	}
}

describe("MinimaxHandler", () => {
	let handler: MinimaxHandler

	beforeEach(() => {
		handler = new MinimaxHandler({
			minimaxApiKey: "test-api-key",
			minimaxApiLine: "international",
			apiModelId: "MiniMax-M2.1",
		})

		sinon.stub(handler, "ensureClient" as any).returns(fakeClient)
	})

	afterEach(() => {
		sinon.restore()
	})

	it("should not emit duplicate text when content_block_start and text_delta repeat", async () => {
		fakeClient.messages.create.resolves(
			createAsyncIterable([
				{
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "text",
						text: "Good catch! Let me check that workflow too.",
					},
				},
				{
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "text_delta",
						text: "Good catch! Let me check that workflow too.",
					},
				},
			]),
		)

		const chunks: string[] = []
		const messages: ClineStorageMessage[] = [{ role: "user", content: "test" }]

		for await (const chunk of handler.createMessage("system", messages)) {
			if (chunk.type === "text") {
				chunks.push(chunk.text)
			}
		}

		expect(chunks).to.deep.equal(["Good catch! Let me check that workflow too."])
	})
})
