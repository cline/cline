import type { ApiHandler } from "@core/api"
import { strict as assert } from "assert"
import type { ClineApiReqInfo, ClineMessage } from "@/shared/ExtensionMessage"
import { MessageStateHandler } from "../message-state"
import { TaskState } from "../TaskState"
import { updateApiReqMsg } from "../utils"

describe("task utils", () => {
	function createMessageStateHandler() {
		return new MessageStateHandler({
			taskId: "task-utils-test",
			ulid: "task-utils-ulid",
			taskState: new TaskState(),
			updateTaskHistory: async () => [],
		})
	}

	it("finalizes api request metrics with explicit total cost", async () => {
		const handler = createMessageStateHandler()
		const initialInfo: ClineApiReqInfo = {
			request: "analyze files",
			retryStatus: {
				attempt: 2,
				maxAttempts: 3,
				delaySec: 4,
			},
		}

		await handler.addToClineMessages({
			ts: 1,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify(initialInfo),
		} as ClineMessage)

		await updateApiReqMsg({
			messageStateHandler: handler,
			lastApiReqIndex: 0,
			inputTokens: 120,
			outputTokens: 80,
			cacheWriteTokens: 10,
			cacheReadTokens: 5,
			totalCost: 0.42,
			api: {
				getModel: () => ({ info: {} }),
			} as ApiHandler,
		})

		const updatedInfo = JSON.parse(handler.getClineMessages()[0].text || "{}") as ClineApiReqInfo
		assert.equal(updatedInfo.tokensIn, 120)
		assert.equal(updatedInfo.tokensOut, 80)
		assert.equal(updatedInfo.cacheWrites, 10)
		assert.equal(updatedInfo.cacheReads, 5)
		assert.equal(updatedInfo.cost, 0.42)
		assert.equal(updatedInfo.retryStatus, undefined)
	})

	it("preserves request metadata while recording cancel and streaming failure details", async () => {
		const handler = createMessageStateHandler()
		await handler.addToClineMessages({
			ts: 2,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ request: "retry request", model: "claude" }),
		} as ClineMessage)

		await updateApiReqMsg({
			messageStateHandler: handler,
			lastApiReqIndex: 0,
			inputTokens: 50,
			outputTokens: 10,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			api: {
				getModel: () => ({ info: {} }),
			} as ApiHandler,
			cancelReason: "streaming_failed",
			streamingFailedMessage: "network timeout",
			totalCost: 0.1,
		})

		const updatedInfo = JSON.parse(handler.getClineMessages()[0].text || "{}") as ClineApiReqInfo
		assert.equal(updatedInfo.request, "retry request")
		assert.equal((updatedInfo as ClineApiReqInfo & { model?: string }).model, "claude")
		assert.equal(updatedInfo.cancelReason, "streaming_failed")
		assert.equal(updatedInfo.streamingFailedMessage, "network timeout")
		assert.equal(updatedInfo.cost, 0.1)
	})
})
