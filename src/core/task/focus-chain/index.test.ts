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
})
