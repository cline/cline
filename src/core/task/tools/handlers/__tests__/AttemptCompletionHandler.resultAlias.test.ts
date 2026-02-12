import { strict as assert } from "node:assert"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { AttemptCompletionHandler } from "../AttemptCompletionHandler"

function createConfig(options?: { doubleCheckEnabled?: boolean; pending?: boolean }) {
	const taskState = new TaskState()
	taskState.doubleCheckCompletionPending = options?.pending ?? false
	taskState.consecutiveMistakeCount = 2

	const callbacks = {
		sayAndCreateMissingParamError: sinon.stub().resolves("missing-param"),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
	} as unknown as TaskConfig["callbacks"]

	const config = {
		taskId: "task-1",
		ulid: "ulid-1",
		taskState,
		doubleCheckCompletionEnabled: options?.doubleCheckEnabled ?? false,
		messageState: {
			getClineMessages: () => [],
		},
		callbacks,
	} as unknown as TaskConfig

	return { config, callbacks, taskState }
}

describe("AttemptCompletionHandler result alias", () => {
	it("accepts response as result for validation", async () => {
		const { config, callbacks, taskState } = createConfig({ doubleCheckEnabled: true, pending: false })
		const handler = new AttemptCompletionHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.ATTEMPT,
			params: {
				response: "done via response alias",
			},
			partial: false,
		})

		assert.equal(taskState.consecutiveMistakeCount, 0)
		assert.equal(taskState.doubleCheckCompletionPending, true)
		sinon.assert.notCalled(callbacks.sayAndCreateMissingParamError as sinon.SinonStub)
		assert.equal(typeof result, "string")
		assert.ok((result as string).includes("Before completing"))
	})

	it("still errors when both result and response are missing", async () => {
		const { config, callbacks, taskState } = createConfig()
		const handler = new AttemptCompletionHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.ATTEMPT,
			params: {},
			partial: false,
		})

		assert.equal(result, "missing-param")
		assert.equal(taskState.consecutiveMistakeCount, 3)
		sinon.assert.calledOnce(callbacks.sayAndCreateMissingParamError as sinon.SinonStub)
	})
})
