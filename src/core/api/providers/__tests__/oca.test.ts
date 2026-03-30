import { expect } from "chai"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ApiFormat } from "@/shared/proto/index.cline"
import { OcaHandler } from "../oca"

const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

async function collectChunks(stream: AsyncGenerator<any>) {
	const chunks: any[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}
	return chunks
}

describe("OcaHandler.createMessage", () => {
	afterEach(() => {
		sinon.restore()
	})

	it("routes OPENAI_RESPONSES models to createMessageResponsesApi", async () => {
		const handler = new OcaHandler({
			ocaModelInfo: { apiFormat: ApiFormat.OPENAI_RESPONSES } as any,
		})

		const chatStub = sinon.stub(handler as any, "createMessageChatApi").callsFake(async function* () {
			yield { type: "text", text: "chat" }
		})
		const responsesStub = sinon.stub(handler as any, "createMessageResponsesApi").callsFake(async function* () {
			yield { type: "text", text: "responses" }
		})
		const messagesStub = sinon.stub(handler as any, "createMessageMessagesApi").callsFake(async function* () {
			yield { type: "text", text: "messages" }
		})

		const chunks = await collectChunks(handler.createMessage("system", messages))

		expect(chunks).to.deep.equal([{ type: "text", text: "responses" }])
		sinon.assert.notCalled(chatStub)
		sinon.assert.calledOnce(responsesStub)
		sinon.assert.notCalled(messagesStub)
	})

	it("routes ANTHROPIC_CHAT models to createMessageMessagesApi", async () => {
		const handler = new OcaHandler({
			ocaModelInfo: { apiFormat: ApiFormat.ANTHROPIC_CHAT } as any,
		})

		const chatStub = sinon.stub(handler as any, "createMessageChatApi").callsFake(async function* () {
			yield { type: "text", text: "chat" }
		})
		const responsesStub = sinon.stub(handler as any, "createMessageResponsesApi").callsFake(async function* () {
			yield { type: "text", text: "responses" }
		})
		const messagesStub = sinon.stub(handler as any, "createMessageMessagesApi").callsFake(async function* () {
			yield { type: "text", text: "messages" }
		})

		const chunks = await collectChunks(handler.createMessage("system", messages))

		expect(chunks).to.deep.equal([{ type: "text", text: "messages" }])
		sinon.assert.notCalled(chatStub)
		sinon.assert.notCalled(responsesStub)
		sinon.assert.calledOnce(messagesStub)
	})

	it("defaults to createMessageChatApi for OPENAI_CHAT and undefined apiFormat", async () => {
		for (const apiFormat of [ApiFormat.OPENAI_CHAT, undefined]) {
			const handler = new OcaHandler({
				ocaModelInfo: { apiFormat } as any,
			})

			const chatStub = sinon.stub(handler as any, "createMessageChatApi").callsFake(async function* () {
				yield { type: "text", text: "chat" }
			})
			const responsesStub = sinon.stub(handler as any, "createMessageResponsesApi").callsFake(async function* () {
				yield { type: "text", text: "responses" }
			})
			const messagesStub = sinon.stub(handler as any, "createMessageMessagesApi").callsFake(async function* () {
				yield { type: "text", text: "messages" }
			})

			const chunks = await collectChunks(handler.createMessage("system", messages))

			expect(chunks).to.deep.equal([{ type: "text", text: "chat" }])
			sinon.assert.calledOnce(chatStub)
			sinon.assert.notCalled(responsesStub)
			sinon.assert.notCalled(messagesStub)
		}
	})
})
