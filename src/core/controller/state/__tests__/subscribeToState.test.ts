import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import "should"
import { hasActiveStateSubscribers, sendStateUpdate, subscribeToState } from "../subscribeToState"

describe("subscribeToState state broadcast guards", () => {
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
})
