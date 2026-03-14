import { EmptyRequest } from "@shared/proto/cline/common"
import { ClineMessage } from "@shared/proto/cline/ui"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { getRequestRegistry } from "../../grpc-handler"
import type { Controller } from "../../index"
import { registerPartialMessageCallback, sendPartialMessageEvent, subscribeToPartialMessage } from "../subscribeToPartialMessage"

function createProtoMessage({ ts, text, partial }: { ts: number; text: string; partial: boolean }): ClineMessage {
	return {
		ts,
		text,
		partial,
	} as ClineMessage
}

describe("subscribeToPartialMessage throttling", () => {
	let clock: sinon.SinonFakeTimers
	const mockController = {} as Controller
	let activeRequestIds: string[]
	let callbackUnsubscribers: Array<() => void>

	beforeEach(() => {
		clock = sinon.useFakeTimers()
		activeRequestIds = []
		callbackUnsubscribers = []
	})

	afterEach(() => {
		for (const unsubscribe of callbackUnsubscribers) {
			unsubscribe()
		}
		for (const requestId of activeRequestIds) {
			getRequestRegistry().cancelRequest(requestId)
		}
		clock.restore()
	})

	it("coalesces rapid partial updates and sends only the latest queued message", async () => {
		const responseStream = sinon.stub().resolves()
		const requestId = "partial-throttle-coalesce"
		activeRequestIds.push(requestId)

		await subscribeToPartialMessage(mockController, EmptyRequest.create({}), responseStream, requestId)

		await sendPartialMessageEvent(createProtoMessage({ ts: 1, text: "a", partial: true }))
		await sendPartialMessageEvent(createProtoMessage({ ts: 1, text: "ab", partial: true }))
		await sendPartialMessageEvent(createProtoMessage({ ts: 1, text: "abc", partial: true }))

		expect(responseStream.callCount).to.equal(0)

		await clock.tickAsync(100)

		expect(responseStream.callCount).to.equal(1)
		expect(responseStream.firstCall.args[0].text).to.equal("abc")
	})

	it("bypasses throttling for final updates and drops stale queued partials for the same timestamp", async () => {
		const responseStream = sinon.stub().resolves()
		const requestId = "partial-throttle-final"
		activeRequestIds.push(requestId)

		await subscribeToPartialMessage(mockController, EmptyRequest.create({}), responseStream, requestId)

		await sendPartialMessageEvent(createProtoMessage({ ts: 2, text: "streaming...", partial: true }))
		expect(responseStream.callCount).to.equal(0)

		await sendPartialMessageEvent(createProtoMessage({ ts: 2, text: "done", partial: false }))
		expect(responseStream.callCount).to.equal(1)
		expect(responseStream.firstCall.args[0].text).to.equal("done")
		expect(responseStream.firstCall.args[0].partial).to.equal(false)

		await clock.tickAsync(150)
		expect(responseStream.callCount).to.equal(1)
	})

	it("keeps callback subscribers immediate while stream subscribers are throttled", async () => {
		const responseStream = sinon.stub().resolves()
		const callback = sinon.stub()
		const requestId = "partial-throttle-callback"
		activeRequestIds.push(requestId)
		const unsubscribe = registerPartialMessageCallback(callback)
		callbackUnsubscribers.push(unsubscribe)

		await subscribeToPartialMessage(mockController, EmptyRequest.create({}), responseStream, requestId)

		const message = createProtoMessage({ ts: 3, text: "token", partial: true })
		await sendPartialMessageEvent(message)

		expect(callback.callCount).to.equal(1)
		expect(callback.firstCall.args[0]).to.deep.equal(message)
		expect(responseStream.callCount).to.equal(0)

		await clock.tickAsync(100)
		expect(responseStream.callCount).to.equal(1)
	})
})
