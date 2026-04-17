import { strict as assert } from "node:assert"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { Controller } from "../index"
import { resetStateSubscriptionsForTest, subscribeToState } from "../state/subscribeToState"

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

describe("Controller.dispose", () => {
	afterEach(() => {
		resetStateSubscriptionsForTest()
	})

	it("awaits MCP hub disposal before resolving", async () => {
		const events: string[] = []
		let resolveMcpDispose!: () => void
		const mcpDisposePromise = new Promise<void>((resolve) => {
			resolveMcpDispose = resolve
		})

		const controllerLike = {
			remoteConfigTimer: undefined,
			clearTask: async () => {
				events.push("clearTask")
			},
			mcpHub: {
				dispose: async () => {
					events.push("mcpDispose:start")
					await mcpDisposePromise
					events.push("mcpDispose:end")
				},
			},
		} as any

		const disposePromise = Controller.prototype.dispose.call(controllerLike)
		await Promise.resolve()

		assert.deepStrictEqual(events, ["clearTask", "mcpDispose:start"])

		let settled = false
		void disposePromise.then(() => {
			settled = true
		})
		await Promise.resolve()
		assert.equal(settled, false)

		resolveMcpDispose()
		await disposePromise

		assert.deepStrictEqual(events, ["clearTask", "mcpDispose:start", "mcpDispose:end"])
	})

	it("postStateToWebview skips building state when there are no active subscribers", async () => {
		let stateCalls = 0
		const controllerLike = {
			getStateToPostToWebview: async () => {
				stateCalls += 1
				return { mode: "act", clineMessages: [] }
			},
		} as any

		await Controller.prototype.postStateToWebview.call(controllerLike)

		assert.equal(stateCalls, 0)
	})

	it("postStateToWebview broadcasts large clineMessages snapshots through the controller path", async () => {
		const payloads: string[] = []
		const responseStream = async ({ stateJson }: { stateJson: string }) => {
			payloads.push(stateJson)
		}

		const initialLargeState = {
			mode: "act",
			clineMessages: [{ ts: 1, type: "say", say: "text", text: "x".repeat(512 * 1024) }],
		} as any
		const changedLargeState = {
			mode: "act",
			clineMessages: [{ ts: 2, type: "say", say: "text", text: "y".repeat(512 * 1024) }],
		} as any

		const getStateToPostToWebview = sinon.stub()
		getStateToPostToWebview.onFirstCall().resolves(initialLargeState)
		getStateToPostToWebview.onSecondCall().resolves(changedLargeState)

		const controllerLike = { getStateToPostToWebview } as any

		await subscribeToState(controllerLike, {} as any, responseStream)
		assert.equal(payloads.length, 1)
		assert.equal(payloads[0], JSON.stringify(initialLargeState))

		await Controller.prototype.postStateToWebview.call(controllerLike)

		assert.equal(payloads.length, 2)
		assert.equal(payloads[1], JSON.stringify(changedLargeState))
		sinon.assert.calledTwice(getStateToPostToWebview)
	})
})
