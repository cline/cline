import { Controller } from "@core/controller"
import { HistoryItem } from "@shared/HistoryItem"
import { expect } from "chai"
import { describe, it } from "mocha"
import * as sinon from "sinon"

describe("getPreviousUserRequest", () => {
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

		const stateManagerStub = {
			getGlobalStateKey: sinon.stub().withArgs("taskHistory").returns(taskHistory),
		}

		const controller = new Controller({} as any)
		;(controller as any).stateManager = stateManagerStub

		const previousUserRequest = controller.getPreviousUserRequest()

		expect(previousUserRequest).to.equal("second request")
	})
})
