import { strict as assert } from "assert"
import { sendStateUpdate, subscribeToState } from "./subscribeToState"

describe("subscribeToState", () => {
	it("sends the latest full snapshot immediately when a subscriber connects", async () => {
		const received: string[] = []
		const initialState = {
			mode: "act",
			clineMessages: [],
			currentTaskItem: { id: "task-42", task: "Resume me", ts: 42 },
		}
		const controller = {
			getStateToPostToWebview: async () => initialState,
		} as any

		await subscribeToState(controller, {} as any, async (message) => {
			received.push(message.stateJson ?? "")
		})

		assert.equal(received.length, 1)
		assert.deepEqual(JSON.parse(received[0]), initialState)
	})

	it("returns delivery stats and broadcasts updates to subscribers", async () => {
		const received: string[] = []
		const controller = {
			getStateToPostToWebview: async () => ({ mode: "act", clineMessages: [] }),
		} as any

		await subscribeToState(controller, {} as any, async (message) => {
			received.push(message.stateJson ?? "")
		})

		assert.equal(received.length, 1)

		const stats = await sendStateUpdate({ mode: "plan", clineMessages: [] } as any)
		assert.equal(received.length, 2)
		assert.ok(stats.payloadBytes > 0)
		assert.ok(stats.sendDurationMs >= 0)
		assert.ok(stats.subscriberCount >= 1)
		assert.ok(received[1]?.includes('"mode":"plan"'))
	})
})
