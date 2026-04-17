import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { FocusChainManager } from "./index"

describe("FocusChainManager lifecycle guards", () => {
	it("does not post state from a queued debounce after dispose", async () => {
		const clock = sinon.useFakeTimers()
		const postStateToWebview = sinon.stub().resolves()
		const manager = new FocusChainManager({
			taskId: "task-1",
			taskState: {
				currentFocusChainChecklist: null,
				todoListWasUpdatedByUser: false,
				apiRequestCount: 0,
				apiRequestsSinceLastTodoUpdate: 0,
				didRespondToPlanAskBySwitchingMode: false,
			} as any,
			mode: "act" as any,
			stateManager: {
				getGlobalSettingsKey: () => "act",
			} as any,
			postStateToWebview,
			say: sinon.stub().resolves(undefined),
			focusChainSettings: {
				enabled: true,
				remindClineInterval: 5,
			} as any,
		})

		sinon.stub(manager as any, "readFocusChainFromDisk").resolves("- [ ] test")
		;(manager as any).updateFCListFromMarkdownFileAndNotifyUI()
		manager.dispose()

		await clock.tickAsync(350)
		assert.equal(postStateToWebview.called, false)

		clock.restore()
	})

	it("closes the file watcher when disposed", async () => {
		const close = sinon.stub()
		const manager = new FocusChainManager({
			taskId: "task-2",
			taskState: {
				currentFocusChainChecklist: null,
				todoListWasUpdatedByUser: false,
				apiRequestCount: 0,
				apiRequestsSinceLastTodoUpdate: 0,
				didRespondToPlanAskBySwitchingMode: false,
			} as any,
			mode: "act" as any,
			stateManager: {
				getGlobalSettingsKey: () => "act",
			} as any,
			postStateToWebview: sinon.stub().resolves(),
			say: sinon.stub().resolves(undefined),
			focusChainSettings: {
				enabled: true,
				remindClineInterval: 5,
			} as any,
		})

		;(manager as any).focusChainFileWatcher = { close }

		await manager.dispose()

		assert.equal(close.calledOnce, true)
		assert.equal((manager as any).focusChainFileWatcher, undefined)
	})

	it("does not accumulate watcher references across repeated dispose cycles", async () => {
		const closes: sinon.SinonStub[] = []

		for (let i = 0; i < 5; i++) {
			const close = sinon.stub()
			closes.push(close)
			const manager = new FocusChainManager({
				taskId: `task-${i}`,
				taskState: {
					currentFocusChainChecklist: null,
					todoListWasUpdatedByUser: false,
					apiRequestCount: 0,
					apiRequestsSinceLastTodoUpdate: 0,
					didRespondToPlanAskBySwitchingMode: false,
				} as any,
				mode: "act" as any,
				stateManager: {
					getGlobalSettingsKey: () => "act",
				} as any,
				postStateToWebview: sinon.stub().resolves(),
				say: sinon.stub().resolves(undefined),
				focusChainSettings: {
					enabled: true,
					remindClineInterval: 5,
				} as any,
			})

			;(manager as any).focusChainFileWatcher = { close }
			await manager.dispose()
			assert.equal((manager as any).focusChainFileWatcher, undefined)
		}

		for (const close of closes) {
			assert.equal(close.calledOnce, true)
		}
	})

	it("awaits async watcher closure before dispose resolves", async () => {
		let resolveClose!: () => void
		const closePromise = new Promise<void>((resolve) => {
			resolveClose = resolve
		})
		const manager = new FocusChainManager({
			taskId: "task-async",
			taskState: {
				currentFocusChainChecklist: null,
				todoListWasUpdatedByUser: false,
				apiRequestCount: 0,
				apiRequestsSinceLastTodoUpdate: 0,
				didRespondToPlanAskBySwitchingMode: false,
			} as any,
			mode: "act" as any,
			stateManager: {
				getGlobalSettingsKey: () => "act",
			} as any,
			postStateToWebview: sinon.stub().resolves(),
			say: sinon.stub().resolves(undefined),
			focusChainSettings: {
				enabled: true,
				remindClineInterval: 5,
			} as any,
		})

		;(manager as any).focusChainFileWatcher = {
			close: sinon.stub().returns(closePromise),
		}

		const disposePromise = manager.dispose()
		await Promise.resolve()

		let settled = false
		void disposePromise.then(() => {
			settled = true
		})
		await Promise.resolve()
		assert.equal(settled, false)

		resolveClose()
		await disposePromise

		assert.equal((manager as any).focusChainFileWatcher, undefined)
	})
})
