import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../../index"
import { clearOrganizationForClinePassProviderSelection } from "../handleClinePassProviderSelection"

/** Let the fire-and-forget switchAccount promise chain settle. */
function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve))
}

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

	it("does nothing when ClinePass is not selected", () => {
		clearOrganizationForClinePassProviderSelection(createController(), {
			planModeApiProvider: "cline",
			actModeApiProvider: "openrouter",
		})

		expect(switchAccount.callCount).toBe(0)
	})

	it("switches to the personal account when ClinePass is selected without blocking the caller", () => {
		clearOrganizationForClinePassProviderSelection(createController(), {
			planModeApiProvider: "cline-pass",
			actModeApiProvider: "openrouter",
		})

		expect(switchAccount.callCount).toBe(1)
		expect(switchAccount.firstCall.args[0]).toBeUndefined()
	})

	it("logs and swallows account switch failures", async () => {
		const error = new Error("not signed in")
		switchAccount.rejects(error)

		clearOrganizationForClinePassProviderSelection(createController(), {
			planModeApiProvider: "cline",
			actModeApiProvider: "cline-pass",
		})
		await flushMicrotasks()

		expect(switchAccount.callCount).toBe(1)
		expect(switchAccount.firstCall.args[0]).toBeUndefined()
		expect((Logger.debug as sinon.SinonStub).calledOnce).toBe(true)
	})
})
