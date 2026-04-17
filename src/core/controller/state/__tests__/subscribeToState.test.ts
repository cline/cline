import { describe, it } from "mocha"
import "should"
import { hasActiveStateSubscribers, sendStateUpdate } from "../subscribeToState"

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
})
