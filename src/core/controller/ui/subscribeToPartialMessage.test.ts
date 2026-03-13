import { EmptyRequest } from "@shared/proto/cline/common"
import { ClineAsk, ClineMessage, ClineMessageType, ClineSay } from "@shared/proto/cline/ui"
import { expect } from "chai"
import { afterEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { registerPartialMessageCallback, sendPartialMessageEvent, subscribeToPartialMessage } from "./subscribeToPartialMessage"

describe("subscribeToPartialMessage", () => {
	afterEach(() => {
		for (const [requestId] of getRequestRegistry().getAllRequests()) {
			getRequestRegistry().cancelRequest(requestId)
		}
		sinon.restore()
	})

	function createPartialSayMessage(text: string): ClineMessage {
		return ClineMessage.create({
			ts: Date.now(),
			type: ClineMessageType.SAY,
			say: ClineSay.TEXT,
			ask: ClineAsk.FOLLOWUP,
			text,
			partial: true,
		})
	}

	it("broadcasts partial messages to gRPC subscribers and unregisters on cancel", async () => {
		const responseStream = sinon.stub().resolves() as unknown as StreamingResponseHandler<ClineMessage>

		await subscribeToPartialMessage({} as any, EmptyRequest.create({}), responseStream, "partial-req-1")
		expect(getRequestRegistry().hasRequest("partial-req-1")).to.equal(true)

		const firstMessage = createPartialSayMessage("stream-1")
		await sendPartialMessageEvent(firstMessage)

		expect((responseStream as any).calledOnce).to.equal(true)
		expect((responseStream as any).firstCall.args[0]).to.deep.equal(firstMessage)
		expect((responseStream as any).firstCall.args[1]).to.equal(false)

		getRequestRegistry().cancelRequest("partial-req-1")
		expect(getRequestRegistry().hasRequest("partial-req-1")).to.equal(false)

		const secondMessage = createPartialSayMessage("stream-2")
		await sendPartialMessageEvent(secondMessage)

		expect((responseStream as any).calledOnce).to.equal(true)
	})

	it("broadcasts partial messages to callback subscribers until unsubscribed", async () => {
		const received: ClineMessage[] = []
		const unsubscribe = registerPartialMessageCallback((message) => {
			received.push(message)
		})

		const firstMessage = createPartialSayMessage("callback-1")
		await sendPartialMessageEvent(firstMessage)

		expect(received).to.deep.equal([firstMessage])

		unsubscribe()

		const secondMessage = createPartialSayMessage("callback-2")
		await sendPartialMessageEvent(secondMessage)

		expect(received).to.deep.equal([firstMessage])
	})

	it("removes failing gRPC subscribers without failing the broadcast", async () => {
		const failingStream = sinon
			.stub()
			.rejects(new Error("stream failed")) as unknown as StreamingResponseHandler<ClineMessage>
		const healthyStream = sinon.stub().resolves() as unknown as StreamingResponseHandler<ClineMessage>

		await subscribeToPartialMessage({} as any, EmptyRequest.create({}), failingStream, "partial-req-fail")
		await subscribeToPartialMessage({} as any, EmptyRequest.create({}), healthyStream, "partial-req-ok")

		const firstMessage = createPartialSayMessage("fanout-1")
		await sendPartialMessageEvent(firstMessage)

		expect((failingStream as any).calledOnce).to.equal(true)
		expect((healthyStream as any).calledOnce).to.equal(true)

		const secondMessage = createPartialSayMessage("fanout-2")
		await sendPartialMessageEvent(secondMessage)

		expect((failingStream as any).calledOnce).to.equal(true)
		expect((healthyStream as any).calledTwice).to.equal(true)
	})
})
