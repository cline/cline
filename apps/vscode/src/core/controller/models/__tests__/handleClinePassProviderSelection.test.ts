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
	let resetCloudSessions: sinon.SinonStub
	let activeOrganizationId: string | undefined

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		switchAccount = sandbox.stub().resolves()
		// The real reset detaches cloud hosts, then runs the account change inside the new scope.
		resetCloudSessions = sandbox.stub().callsFake((changeScope?: () => Promise<void>) => changeScope?.())
		activeOrganizationId = "org-1"
		sandbox.stub(Logger, "debug")
	})

	afterEach(() => {
		sandbox.restore()
	})

	function createController(): Controller {
		return {
			accountService: { switchAccount },
			authService: { getActiveOrganizationId: () => activeOrganizationId },
			resetCloudSessions,
		} as unknown as Controller
	}

	it("does nothing when ClinePass is not selected", () => {
		clearOrganizationForClinePassProviderSelection(createController(), {
			planModeApiProvider: "cline",
			actModeApiProvider: "openrouter",
		})

		expect(switchAccount.callCount).toBe(0)
		expect(resetCloudSessions.callCount).toBe(0)
	})

	it("leaves a displayed cloud task alone when the account is already Personal", () => {
		// Any API configuration change (a model pick, say) reaches here; the reset
		// would clear the displayed cloud task for no account change.
		activeOrganizationId = undefined

		clearOrganizationForClinePassProviderSelection(createController(), {
			planModeApiProvider: "cline-pass",
			actModeApiProvider: "cline-pass",
		})

		expect(resetCloudSessions.callCount).toBe(0)
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

	it("changes the account through the cloud-session reset so organization tasks are torn down first", async () => {
		let releaseReset!: () => void
		resetCloudSessions.callsFake(
			(changeScope?: () => Promise<void>) =>
				new Promise<void>((resolve) => {
					releaseReset = () => void changeScope?.().then(resolve)
				}),
		)

		clearOrganizationForClinePassProviderSelection(createController(), {
			planModeApiProvider: "cline-pass",
			actModeApiProvider: "cline-pass",
		})
		await flushMicrotasks()

		// The account must not change while the previous account's cloud hosts are still attached.
		expect(resetCloudSessions.callCount).toBe(1)
		expect(switchAccount.callCount).toBe(0)
		releaseReset()
		await flushMicrotasks()
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
