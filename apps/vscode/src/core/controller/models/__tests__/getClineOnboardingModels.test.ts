import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import type { Controller } from "../../index"
import { clearOnboardingModelsCache, getClineOnboardingModels } from "../getClineOnboardingModels"
import * as refreshClineModelsModule from "../refreshClineModels"
import * as refreshClineRecommendedModelsModule from "../refreshClineRecommendedModels"

describe("getClineOnboardingModels", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		clearOnboardingModelsCache()
	})

	afterEach(() => {
		clearOnboardingModelsCache()
		sandbox.restore()
	})

	it("caches empty onboarding model results for a short TTL", async () => {
		const clock = sandbox.useFakeTimers({ now: Date.now(), toFake: ["Date"] })
		const refreshRecommendedModelsStub = sandbox
			.stub(refreshClineRecommendedModelsModule, "refreshClineRecommendedModels")
			.resolves({ recommended: [], free: [] })
		const refreshClineModelsStub = sandbox.stub(refreshClineModelsModule, "refreshClineModels").resolves({})
		const controller = {} as Controller

		const firstResult = await getClineOnboardingModels(controller)
		const secondResult = await getClineOnboardingModels(controller)

		expect(firstResult).to.deep.equal({ models: [] })
		expect(secondResult).to.deep.equal({ models: [] })
		expect(refreshRecommendedModelsStub.calledOnce).to.equal(true)
		expect(refreshClineModelsStub.calledOnce).to.equal(true)

		clock.tick(30_001)
		await getClineOnboardingModels(controller)

		expect(refreshRecommendedModelsStub.calledTwice).to.equal(true)
		expect(refreshClineModelsStub.calledTwice).to.equal(true)
	})
})
