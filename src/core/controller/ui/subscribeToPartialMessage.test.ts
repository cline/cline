import { strict as assert } from "assert"
import { registerPartialMessageCallback, sendPartialMessageEvent, subscribeToPartialMessage } from "./subscribeToPartialMessage"

describe("subscribeToPartialMessage", () => {
	it("returns delivery stats and broadcasts to stream and callback subscribers", async () => {
		const callbackMessages: any[] = []
		const streamMessages: any[] = []
		const unsubscribe = registerPartialMessageCallback((message) => callbackMessages.push(message))

		await subscribeToPartialMessage({} as any, {} as any, async (message) => {
			streamMessages.push(message)
		})

		const stats = await sendPartialMessageEvent({ ts: 123, type: "say", say: "text", text: "hello" } as any)
		unsubscribe()

		assert.equal(callbackMessages.length, 1)
		assert.equal(streamMessages.length, 1)
		assert.ok(stats.payloadBytes > 0)
		assert.ok(stats.broadcastDurationMs >= 0)
		assert.ok(stats.streamSubscriberCount >= 1)
		assert.ok(stats.callbackSubscriberCount >= 1)
	})
})
