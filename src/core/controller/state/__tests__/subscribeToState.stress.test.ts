import { strict as assert } from "node:assert"
import { afterEach, describe, it } from "mocha"
import { measureAsyncOperation, measureUtf8Bytes } from "@/test/stress-utils"
import { resetStateSubscriptionsForTest, sendStateUpdate, subscribeToState } from "../subscribeToState"

describe("subscribeToState soak", () => {
	afterEach(() => {
		resetStateSubscriptionsForTest()
	})

	it("handles 1,000 repeated state broadcasts with a growing conversation within a bounded budget", async function () {
		this.timeout(20_000)

		const sentPayloads: string[] = []
		const responseStream = async ({ stateJson }: { stateJson: string }) => {
			sentPayloads.push(stateJson)
		}
		const controller = {
			getStateToPostToWebview: async () => ({ mode: "act", clineMessages: [] }),
		} as any

		await subscribeToState(controller, {} as any, responseStream)

		const messageChunk = "x".repeat(1024)
		const measured = await measureAsyncOperation("subscribeToState soak broadcasts", async () => {
			for (let i = 1; i <= 1_000; i++) {
				await sendStateUpdate({
					mode: "act",
					clineMessages: Array.from({ length: i }, (_, index) => ({
						ts: index,
						type: "say",
						say: "text",
						text: `${index}-${messageChunk}`,
					})),
				} as any)
			}

			return sentPayloads[sentPayloads.length - 1]
		})

		assert.equal(sentPayloads.length, 1_001)
		assert.ok(measured.result)
		assert.ok(measureUtf8Bytes(measured.result!).toString())
		assert.ok(measureUtf8Bytes(measured.result!) >= 1_000 * 1024)
		assert.ok(measured.durationMs < 20_000)
		// This soak intentionally grows the serialized conversation to ~1MB+ across 1,000 updates.
		// Keep the heap-growth budget meaningful without making it unrealistically tight for CI variance.
		assert.ok(measured.diff.heapUsedDelta < 512 * 1024 * 1024)
	})
})
