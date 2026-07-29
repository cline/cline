import * as assert from "assert"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../../index"
import { clearOrganizationForClinePassProviderSelection } from "../handleClinePassProviderSelection"

describe("clearOrganizationForClinePassProviderSelection", () => {
	let sandbox: sinon.SinonSandbox
	let switchAccount: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		switchAccount = sandbox.stub().resolves()
		sandbox.stub(Logger, "debug")
	})

	afterEach(() => {
		sandbox.restore()
	})

	function createController(): Controller {
		return {
			accountService: { switchAccount },
		} as unknown as Controller
	}

	it("does nothing when ClinePass is not selected", async () => {
		await clearOrganizationForClinePassProviderSelection(createController(), {
			planModeApiProvider: "cline",
			actModeApiProvider: "openrouter",
		})

		assert.strictEqual(switchAccount.callCount, 0)
	})

	it("switches to the personal account when ClinePass is selected", async () => {
		await clearOrganizationForClinePassProviderSelection(createController(), {
			planModeApiProvider: "cline-pass",
			actModeApiProvider: "openrouter",
		})

		assert.strictEqual(switchAccount.callCount, 1)
		assert.strictEqual(switchAccount.firstCall.args[0], null)
	})

	it("logs and swallows account switch failures", async () => {
		const error = new Error("not signed in")
		switchAccount.rejects(error)

		await clearOrganizationForClinePassProviderSelection(createController(), {
			planModeApiProvider: "cline",
			actModeApiProvider: "cline-pass",
		})

		assert.strictEqual(switchAccount.callCount, 1)
		assert.strictEqual(switchAccount.firstCall.args[0], null)
		assert.ok((Logger.debug as sinon.SinonStub).calledOnce)
	})
})
