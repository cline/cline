// Tests for the user.auth_logged_out reason mapping: the old catch-all
// ERROR_RECOVERY is split into NO_STORED_SESSION / TOKEN_INVALID /
// RESTORE_ERROR, carried atomically by the provider's discriminated
// retrieve result.

import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { Controller } from "@/core/controller"
import { injectTelemetryServiceForTest, resetTelemetryService } from "@/services/telemetry"
import { TelemetryService } from "@/services/telemetry/TelemetryService"
import { Logger } from "@/shared/services/Logger"
import { AuthInvalidTokenError, AuthNetworkError } from "../../error/ClineError"
import { AuthService, ClineAuthInfo } from "../AuthService"
import { ClineAuthProvider } from "../providers/ClineAuthProvider"
import { LogoutReason } from "../types"

class TestableAuthService extends AuthService {
	constructor(controller: Controller) {
		super(controller)
	}
}

/**
 * Fire-and-forget calls through the `telemetryService` proxy settle within
 * the current microtask/macrotask queue because the singleton is pre-seeded
 * with a settled instance (never entering the async create() path). One
 * macrotask turn also flushes the setImmediate-deferred auth status update.
 */
async function settle(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve))
}

describe("AuthService logout telemetry reasons", () => {
	let sandbox: sinon.SinonSandbox
	let capturedLoggedOut: sinon.SinonStub
	let service: TestableAuthService
	let retrieveClineAuthInfoStub: sinon.SinonStub

	const authInfo: ClineAuthInfo = {
		idToken: "id-token",
		refreshToken: "refresh-token",
		expiresAt: Date.now() / 1000 + 3600,
		userInfo: {
			createdAt: "2026-01-01T00:00:00Z",
			displayName: "Test User",
			email: "test@example.com",
			id: "user_1",
			organizations: [],
		},
		provider: "cline",
	}

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		sandbox.stub(Logger, "warn")
		sandbox.stub(Logger, "error")
		sandbox.stub(Logger, "info")
		sandbox.stub(Logger, "debug")

		// Inject a settled instance at the proxy boundary so fire-and-forget
		// telemetry promises resolve deterministically against these stubs and
		// never reach real infrastructure (e.g. HostProvider) after restore.
		const telemetryInstance = new TelemetryService([], {} as any)
		capturedLoggedOut = sandbox.stub(telemetryInstance, "captureAuthLoggedOut")
		sandbox.stub(telemetryInstance, "capture")
		injectTelemetryServiceForTest(telemetryInstance)

		service = new TestableAuthService({} as Controller)
		sandbox.stub(service, "sendAuthStatusUpdate").resolves()
		retrieveClineAuthInfoStub = sandbox.stub((service as any)._provider, "retrieveClineAuthInfo")
	})

	afterEach(async () => {
		// Let any stragglers hit the injected instance before restoring stubs.
		await settle()
		resetTelemetryService()
		sandbox.restore()
	})

	describe("restoreRefreshTokenAndRetrieveAuthInfo()", () => {
		it("reports no_stored_session when restore finds no session", async () => {
			retrieveClineAuthInfoStub.resolves({ kind: "no_stored_session" })

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await settle()

			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.NO_STORED_SESSION])
		})

		it("reports token_invalid when the stored refresh token is rejected at startup", async () => {
			retrieveClineAuthInfoStub.resolves({ kind: "token_invalid" })

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await settle()

			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.TOKEN_INVALID])
			expect((service as any)._authenticated).to.be.false
		})

		it("reports restore_error when a stored session cannot be restored", async () => {
			retrieveClineAuthInfoStub.resolves({ kind: "restore_error" })

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await settle()

			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.RESTORE_ERROR])
			expect((service as any)._authenticated).to.be.false
		})

		it("reports restore_error when restore itself throws", async () => {
			// The provider never throws by contract; this covers the
			// defensive path (e.g. waiting on a concurrent refresh failed).
			retrieveClineAuthInfoStub.rejects(new Error("secret storage unavailable"))

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await settle()

			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.RESTORE_ERROR])
		})

		it("reports nothing when the session is deliberately retained", async () => {
			// Rollout stand-down / refresh cooldown: the stored session is
			// kept, so this is neither a logout nor a signed-out machine.
			retrieveClineAuthInfoStub.resolves({ kind: "session_retained" })

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await settle()

			expect(capturedLoggedOut.called).to.be.false
			expect((service as any)._authenticated).to.be.false
		})

		it("reports nothing when restore succeeds", async () => {
			retrieveClineAuthInfoStub.resolves({ kind: "success", authInfo })

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await settle()

			expect(capturedLoggedOut.called).to.be.false
			expect((service as any)._authenticated).to.be.true
		})

		it("keeps the restored session when the post-restore status broadcast fails", async () => {
			// A status-update failure after a successful restore is not a
			// restore failure: no restore_error, and the session survives.
			retrieveClineAuthInfoStub.resolves({ kind: "success", authInfo })
			;(service.sendAuthStatusUpdate as sinon.SinonStub).rejects(new Error("webview gone"))

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await settle()

			expect(capturedLoggedOut.called).to.be.false
			expect((service as any)._authenticated).to.be.true
			expect((service as any)._clineAuthInfo).to.deep.equal(authInfo)
		})
	})

	describe("getAuthToken() refresh failures", () => {
		beforeEach(() => {
			// Signed-in session whose access token needs a refresh.
			;(service as any)._clineAuthInfo = { ...authInfo, expiresAt: Date.now() / 1000 - 60 }
			;(service as any)._authenticated = true
			sandbox.stub((service as any)._provider, "shouldRefreshIdToken").resolves(true)
		})

		it("reports token_invalid when the refresh token is rejected mid-session, without changing auth state", async () => {
			retrieveClineAuthInfoStub.resolves({ kind: "token_invalid" })

			const token = await service.getAuthToken()
			await settle()

			expect(token).to.be.null
			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.TOKEN_INVALID])
			// Telemetry only: state keeps the stale session exactly as before.
			expect((service as any)._authenticated).to.be.true
			expect((service as any)._clineAuthInfo).to.not.be.null
		})

		it("reports nothing on transient network failures", async () => {
			// The provider surfaces those as a success carrying the stale
			// stored data; the expiry check in getAuthToken() returns null.
			retrieveClineAuthInfoStub.resolves({
				kind: "success",
				authInfo: { ...authInfo, expiresAt: Date.now() / 1000 - 60 },
			})

			const token = await service.getAuthToken()
			await settle()

			expect(token).to.be.null
			expect(capturedLoggedOut.called).to.be.false
		})

		it("reports nothing when the session is deliberately retained mid-session", async () => {
			retrieveClineAuthInfoStub.resolves({ kind: "session_retained" })

			const token = await service.getAuthToken()
			await settle()

			expect(token).to.be.null
			expect(capturedLoggedOut.called).to.be.false
			expect((service as any)._authenticated).to.be.true
		})
	})

	describe("ClineAuthProvider retrieve outcomes", () => {
		const makeController = (storedAuthData: string | undefined): Controller =>
			({
				stateManager: {
					getSecretKey: () => storedAuthData,
					setSecret: () => {},
				},
			}) as unknown as Controller

		/** Expired session so retrieveClineAuthInfo() enters the refresh path. */
		const expiredStoredData = JSON.stringify({
			idToken: "not-a-jwt",
			refreshToken: "refresh-token",
			expiresAt: Date.now() / 1000 - 60,
			userInfo: { id: "user_1" },
			provider: "cline",
		})

		it("returns no_stored_session when nothing is stored", async () => {
			const provider = new ClineAuthProvider()

			const result = await provider.retrieveClineAuthInfo(makeController(undefined))

			expect(result).to.deep.equal({ kind: "no_stored_session" })
		})

		it("returns restore_error for malformed stored auth data", async () => {
			const provider = new ClineAuthProvider()

			const result = await provider.retrieveClineAuthInfo(makeController("not-json{"))

			expect(result).to.deep.equal({ kind: "restore_error" })
		})

		it("returns restore_error when stored auth data is missing tokens", async () => {
			const provider = new ClineAuthProvider()

			const result = await provider.retrieveClineAuthInfo(makeController(JSON.stringify({ userInfo: {} })))

			expect(result).to.deep.equal({ kind: "restore_error" })
		})

		/** ClineEnv isn't initialized in unit tests; the refresh path logs config.apiBaseUrl. */
		const stubConfig = (provider: ClineAuthProvider) =>
			sandbox.stub(provider, "config").get(() => ({ apiBaseUrl: "https://api.test" }))

		it("returns token_invalid when the refresh endpoint rejects the stored token", async () => {
			const provider = new ClineAuthProvider()
			stubConfig(provider)
			sandbox.stub(provider, "refreshToken").rejects(new AuthInvalidTokenError("invalid or expired token"))

			const result = await provider.retrieveClineAuthInfo(makeController(expiredStoredData))

			expect(result).to.deep.equal({ kind: "token_invalid" })
		})

		it("returns the stale session as success on transient refresh failures", async () => {
			const provider = new ClineAuthProvider()
			stubConfig(provider)
			sandbox.stub(provider, "refreshToken").rejects(new AuthNetworkError("status: 503"))

			const result = await provider.retrieveClineAuthInfo(makeController(expiredStoredData))

			expect(result.kind).to.equal("success")
		})

		it("returns session_retained during the refresh-retry cooldown", async () => {
			const provider = new ClineAuthProvider()
			;(provider as any).refreshRetryCount = 1
			;(provider as any).lastRefreshAttempt = Date.now()

			const result = await provider.retrieveClineAuthInfo(makeController(expiredStoredData))

			expect(result).to.deep.equal({ kind: "session_retained" })
		})
	})
})
