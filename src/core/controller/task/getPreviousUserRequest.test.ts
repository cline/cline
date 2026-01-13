import { Controller } from "@core/controller"
import { StateManager } from "@core/storage/StateManager"
import { HistoryItem } from "@shared/HistoryItem"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"

describe("getPreviousUserRequest", () => {
	let sandbox: sinon.SinonSandbox
	let stateManagerStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should return the previous user request", () => {
		const taskHistory: HistoryItem[] = [
			{
				id: "1",
				ts: 1,
				task: "first request",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			},
			{
				id: "2",
				ts: 2,
				task: "second request",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			},
			{
				id: "3",
				ts: 3,
				task: "third request",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			},
		]

		// Stub StateManager.get() BEFORE creating Controller
		const mockStateManager = {
			getGlobalStateKey: sinon.stub().callsFake((key: string) => {
				if (key === "taskHistory") {
					return taskHistory
				}
				return undefined
			}),
			getGlobalSettingsKey: sinon.stub().returns(undefined),
			getApiConfiguration: sinon.stub().returns({}),
			getRemoteConfigSettings: sinon.stub().returns({}),
			registerCallbacks: sinon.stub(),
		}
		stateManagerStub = sandbox.stub(StateManager, "get").returns(mockStateManager as any)

		const controller = new Controller({} as any)

		const previousUserRequest = controller.getPreviousUserRequest()

		expect(previousUserRequest).to.equal("second request")
	})
})
