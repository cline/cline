import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { Controller } from "../index"

describe("Controller.updateTaskHistory", () => {
	it("skips persisting when the incoming task history item is unchanged", async () => {
		const existingItem = {
			id: "task-1",
			ulid: "01-test",
			ts: 123,
			task: "Investigate crash",
			tokensIn: 10,
			tokensOut: 20,
			cacheWrites: 0,
			cacheReads: 0,
			totalCost: 0,
			size: 100,
			cwdOnTaskInitialization: "/tmp/project",
			isFavorited: false,
		} as any
		const history = [existingItem]
		const stateManager = {
			getGlobalStateKey: sinon.stub().withArgs("taskHistory").returns(history),
			setGlobalState: sinon.stub(),
		}

		const result = await Controller.prototype.updateTaskHistory.call({ stateManager } as any, { ...existingItem })

		assert.equal(result, history)
		sinon.assert.notCalled(stateManager.setGlobalState)
	})

	it("persists when an existing task history item changes", async () => {
		const existingItem = {
			id: "task-1",
			ulid: "01-test",
			ts: 123,
			task: "Investigate crash",
			tokensIn: 10,
			tokensOut: 20,
			cacheWrites: 0,
			cacheReads: 0,
			totalCost: 0,
			size: 100,
			cwdOnTaskInitialization: "/tmp/project",
			isFavorited: false,
		} as any
		const updatedItem = {
			...existingItem,
			tokensOut: 21,
			size: 101,
		} as any
		const history = [existingItem]
		const stateManager = {
			getGlobalStateKey: sinon.stub().withArgs("taskHistory").returns(history),
			setGlobalState: sinon.stub(),
		}

		const result = await Controller.prototype.updateTaskHistory.call({ stateManager } as any, updatedItem)

		assert.equal(result[0], updatedItem)
		sinon.assert.calledOnceWithExactly(stateManager.setGlobalState, "taskHistory", history)
	})

	it("persists when adding a new task history item", async () => {
		const history: any[] = []
		const newItem = {
			id: "task-2",
			ulid: "02-test",
			ts: 456,
			task: "Reduce persistence churn",
			tokensIn: 5,
			tokensOut: 8,
			cacheWrites: 0,
			cacheReads: 0,
			totalCost: 0,
			size: 50,
			cwdOnTaskInitialization: "/tmp/project",
			isFavorited: false,
		} as any
		const stateManager = {
			getGlobalStateKey: sinon.stub().withArgs("taskHistory").returns(history),
			setGlobalState: sinon.stub(),
		}

		const result = await Controller.prototype.updateTaskHistory.call({ stateManager } as any, newItem)

		assert.equal(result.length, 1)
		assert.equal(result[0], newItem)
		sinon.assert.calledOnceWithExactly(stateManager.setGlobalState, "taskHistory", history)
	})
})
