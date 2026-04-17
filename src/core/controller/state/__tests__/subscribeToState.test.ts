import { strict as assert } from "node:assert"
import { afterEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import { LARGE_STATE_SNAPSHOT_WARNING_BYTES } from "../stateSnapshot"
import { hasActiveStateSubscribers, resetStateSubscriptionsForTest, sendStateUpdate, subscribeToState } from "../subscribeToState"

describe("subscribeToState state broadcast guards", () => {
	afterEach(() => {
		resetStateSubscriptionsForTest()
	})

	it("has no active subscribers by default", () => {
		hasActiveStateSubscribers().should.equal(false)
	})

	it("sendStateUpdate should no-op before serialization when there are no subscribers", async () => {
		await sendStateUpdate({
			toJSON() {
				throw new Error("state should not have been serialized")
			},
		} as any)
	})

	it("suppresses duplicate serialized state updates for the same subscriber", async () => {
		const sentPayloads: string[] = []
		const responseStream = async ({ stateJson }: { stateJson: string }) => {
			sentPayloads.push(stateJson)
		}
		const controller = {
			getStateToPostToWebview: async () => ({ mode: "act", clineMessages: [] }),
		} as any

		await subscribeToState(controller, {} as any, responseStream)
		assert.equal(sentPayloads.length, 1)

		await sendStateUpdate({ mode: "act", clineMessages: [] } as any)
		assert.equal(sentPayloads.length, 1)

		await sendStateUpdate({ mode: "act", clineMessages: [{ ts: 1, type: "say", say: "text", text: "next" }] } as any)
		assert.equal(sentPayloads.length, 2)
	})

	it("warns once for a large clineMessages snapshot and suppresses identical rebroadcasts", async () => {
		const warnStub = sinon.stub(Logger, "warn")
		const sentPayloads: string[] = []
		const responseStream = async ({ stateJson }: { stateJson: string }) => {
			sentPayloads.push(stateJson)
		}

		const oversizedText = "x".repeat(LARGE_STATE_SNAPSHOT_WARNING_BYTES)
		const largeState = {
			mode: "act",
			clineMessages: [{ ts: 1, type: "say", say: "text", text: oversizedText }],
		} as any
		const changedLargeState = {
			mode: "act",
			clineMessages: [{ ts: 1, type: "say", say: "text", text: `${oversizedText}!` }],
		} as any
		const controller = {
			getStateToPostToWebview: async () => largeState,
		} as any

		try {
			await subscribeToState(controller, {} as any, responseStream)
			assert.equal(sentPayloads.length, 1)
			assert.equal(sentPayloads[0], JSON.stringify(largeState))
			sinon.assert.calledOnce(warnStub)

			await sendStateUpdate(largeState)
			assert.equal(sentPayloads.length, 1)

			await sendStateUpdate(changedLargeState)
			assert.equal(sentPayloads.length, 2)
			assert.equal(sentPayloads[1], JSON.stringify(changedLargeState))
			sinon.assert.calledTwice(warnStub)
		} finally {
			warnStub.restore()
		}
	})
})
