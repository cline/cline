import { describe, it } from "mocha"
import "should"
import * as sinon from "sinon"
import { Controller } from "../core/controller"
import * as taskUiDeltaModule from "../core/controller/ui/subscribeToTaskUiDeltas"

describe("Controller.postTaskMetadataDelta", () => {
	it("publishes metadata deltas for the current active task", async () => {
		const sendTaskUiDeltaStub = sinon.stub(taskUiDeltaModule, "sendTaskUiDelta").resolves(undefined)
		const postStateToWebview = sinon.stub().resolves()

		const fakeController = {
			task: {
				taskId: "task-1",
				taskState: {
					taskUiDeltaSequence: 0,
				},
			},
			postStateToWebview,
		}

		await Controller.prototype.postTaskMetadataDelta.call(fakeController as any, {
			backgroundCommandRunning: true,
			backgroundCommandTaskId: "task-1",
		})

		sinon.assert.calledOnce(sendTaskUiDeltaStub)
		sinon.assert.calledWithExactly(sendTaskUiDeltaStub, {
			type: "task_metadata_updated",
			taskId: "task-1",
			sequence: 1,
			metadata: {
				backgroundCommandRunning: true,
				backgroundCommandTaskId: "task-1",
			},
		})
		sinon.assert.notCalled(postStateToWebview)

		sendTaskUiDeltaStub.restore()
	})

	it("falls back to posting full state when task identity is missing or mismatched", async () => {
		const sendTaskUiDeltaStub = sinon.stub(taskUiDeltaModule, "sendTaskUiDelta").resolves(undefined)
		const postStateToWebview = sinon.stub().resolves()

		const fakeController = {
			task: {
				taskId: "task-1",
				taskState: {
					taskUiDeltaSequence: 4,
				},
			},
			postStateToWebview,
		}

		await Controller.prototype.postTaskMetadataDelta.call(
			fakeController as any,
			{ currentFocusChainChecklist: "- [x] one" },
			"task-2",
		)

		sinon.assert.notCalled(sendTaskUiDeltaStub)
		sinon.assert.calledOnce(postStateToWebview)

		sendTaskUiDeltaStub.restore()
	})
})
