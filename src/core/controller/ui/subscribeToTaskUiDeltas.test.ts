import { EmptyRequest } from "@shared/proto/cline/common"
import { TaskUiDeltaEvent } from "@shared/proto/cline/ui"
import { strict as assert } from "assert"
import { registerTaskUiDeltaCallback, sendTaskUiDelta, subscribeToTaskUiDeltas } from "./subscribeToTaskUiDeltas"

describe("subscribeToTaskUiDeltas", () => {
	it("broadcasts serialized task deltas to active stream subscribers", async () => {
		const received: TaskUiDeltaEvent[] = []
		const callbackReceived: Array<{ type: string; sequence: number }> = []
		const unsubscribe = registerTaskUiDeltaCallback((delta) => {
			callbackReceived.push({ type: delta.type, sequence: delta.sequence })
		})

		await subscribeToTaskUiDeltas({} as any, EmptyRequest.create({}), async (message) => {
			received.push(message)
		})

		await sendTaskUiDelta({
			type: "message_updated",
			taskId: "task-1",
			sequence: 1,
			message: { ts: 123, type: "say", say: "text", text: "delta-text" },
		})
		const stats = await sendTaskUiDelta({
			type: "message_updated",
			taskId: "task-1",
			sequence: 2,
			message: { ts: 124, type: "say", say: "text", text: "delta-text-2" },
		})

		assert.equal(received.length, 2)
		assert.ok(received[0]?.deltaJson)
		assert.ok(stats)
		assert.ok((stats?.payloadBytes ?? 0) > 0)
		assert.ok((stats?.broadcastDurationMs ?? -1) >= 0)
		assert.ok((stats?.streamSubscriberCount ?? 0) >= 1)
		assert.ok((stats?.callbackSubscriberCount ?? 0) >= 1)

		const parsed = JSON.parse(received[0]!.deltaJson)
		assert.equal(parsed.type, "message_updated")
		assert.equal(parsed.taskId, "task-1")
		assert.equal(parsed.sequence, 1)
		assert.equal(parsed.message.text, "delta-text")
		const parsedSecond = JSON.parse(received[1]!.deltaJson)
		assert.equal(parsedSecond.sequence, 2)
		assert.equal(parsedSecond.message.text, "delta-text-2")
		assert.deepStrictEqual(callbackReceived, [
			{ type: "message_updated", sequence: 1 },
			{ type: "message_updated", sequence: 2 },
		])
		unsubscribe()
	})

	it("removes stream subscribers that throw during delivery", async () => {
		const received: TaskUiDeltaEvent[] = []

		await subscribeToTaskUiDeltas({} as any, EmptyRequest.create({}), async () => {
			throw new Error("stream disconnected")
		})

		await subscribeToTaskUiDeltas({} as any, EmptyRequest.create({}), async (message) => {
			received.push(message)
		})

		await sendTaskUiDelta({
			type: "task_state_resynced",
			taskId: "task-1",
			sequence: 1,
		})

		await sendTaskUiDelta({
			type: "task_metadata_updated",
			taskId: "task-1",
			sequence: 2,
			metadata: { backgroundCommandRunning: true, backgroundCommandTaskId: "task-1" },
		})

		assert.equal(received.length, 2)
		const first = JSON.parse(received[0]!.deltaJson)
		const second = JSON.parse(received[1]!.deltaJson)
		assert.equal(first.type, "task_state_resynced")
		assert.equal(second.type, "task_metadata_updated")
		assert.equal(second.metadata.backgroundCommandRunning, true)
	})
})
