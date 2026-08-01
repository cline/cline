import * as assert from "node:assert"
import proxyquire from "proxyquire"
import sinon from "sinon"

describe("AuthService rollout stand-down", () => {
	afterEach(() => {
		sinon.restore()
	})

	it("rejects an OAuth callback that arrives after stand-down engages", async () => {
		const notifyRolloutStanddown = sinon.stub()
		const { AuthService } = proxyquire.noCallThru().load("../AuthService", {
			"./rollout-standdown": {
				shouldStandDownAuth: () => true,
				notifyRolloutStanddown,
			},
		})
		const signIn = sinon.stub().resolves({ idToken: "must-not-be-stored" })
		const service = Object.create(AuthService.prototype) as {
			_provider: { signIn: typeof signIn }
			_controller: object
			_authenticated: boolean
			_clineAuthInfo: unknown
			_activeAuthStatusUpdateHandlers: Set<unknown>
			_handlerToController: Map<unknown, unknown>
			handleAuthCallback(code: string, provider: string): Promise<void>
		}
		service._provider = { signIn }
		service._controller = {}
		service._authenticated = false
		service._clineAuthInfo = null
		service._activeAuthStatusUpdateHandlers = new Set()
		service._handlerToController = new Map()

		await service.handleAuthCallback("late-code", "google")

		assert.strictEqual(signIn.called, false)
		assert.strictEqual(notifyRolloutStanddown.calledOnce, true)
		assert.strictEqual(service._authenticated, false)
		assert.strictEqual(service._clineAuthInfo, null)
	})
})
