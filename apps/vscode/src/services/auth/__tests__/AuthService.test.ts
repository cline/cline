// Tests for the user.auth_logged_out reason mapping: the old catch-all
// ERROR_RECOVERY is split into NO_STORED_SESSION / TOKEN_INVALID / RESTORE_ERROR.

import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { Controller } from "@/core/controller"
import { resetTelemetryService } from "@/services/telemetry"
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

/** The exported telemetryService proxy resolves the real service asynchronously. */
async function flushTelemetry(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve))
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

		capturedLoggedOut = sandbox.stub(TelemetryService.prototype, "captureAuthLoggedOut")
		sandbox.stub(TelemetryService, "create").resolves(new TelemetryService([], {} as any))
		resetTelemetryService()

		service = new TestableAuthService({} as Controller)
		sandbox.stub(service, "sendAuthStatusUpdate").resolves()
		retrieveClineAuthInfoStub = sandbox.stub((service as any)._provider, "retrieveClineAuthInfo")
	})

	afterEach(() => {
		resetTelemetryService()
		sandbox.restore()
	})

	describe("restoreRefreshTokenAndRetrieveAuthInfo()", () => {
		it("reports no_stored_session when restore finds no session", async () => {
			retrieveClineAuthInfoStub.resolves(null)

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await flushTelemetry()

			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.NO_STORED_SESSION])
		})

		it("reports restore_error when restore throws", async () => {
			retrieveClineAuthInfoStub.rejects(new Error("secret storage unavailable"))

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await flushTelemetry()

			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.RESTORE_ERROR])
		})

		it("reports token_invalid when the stored refresh token is rejected at startup", async () => {
			// The provider keeps its null-on-error contract (no behavior change)
			// but records WHY via the telemetry breadcrumb; without it these
			// users were binned as no_stored_session.
			retrieveClineAuthInfoStub.resolves(null)
			;(service as any)._provider.lastRetrieveFailure = LogoutReason.TOKEN_INVALID

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await flushTelemetry()

			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.TOKEN_INVALID])
			expect((service as any)._authenticated).to.be.false
		})

		it("reports restore_error when the provider swallows a restore failure into null", async () => {
			// Malformed stored data / unexpected restore errors are converted
			// to null inside the provider; the breadcrumb keeps them from
			// being binned as no_stored_session.
			retrieveClineAuthInfoStub.resolves(null)
			;(service as any)._provider.lastRetrieveFailure = LogoutReason.RESTORE_ERROR

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await flushTelemetry()

			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.RESTORE_ERROR])
			expect((service as any)._authenticated).to.be.false
		})

		it("reports nothing when restore succeeds", async () => {
			retrieveClineAuthInfoStub.resolves(authInfo)

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await flushTelemetry()

			expect(capturedLoggedOut.called).to.be.false
			expect((service as any)._authenticated).to.be.true
		})
	})

	describe("getAuthToken() refresh failures", () => {
		beforeEach(() => {
			// Signed-in session whose access token needs a refresh.
			;(service as any)._clineAuthInfo = { ...authInfo, expiresAt: Date.now() / 1000 - 60 }
			;(service as any)._authenticated = true
			sandbox.stub((service as any)._provider, "shouldRefreshIdToken").resolves(true)
		})

		it("reports token_invalid when the refresh token is rejected", async () => {
			retrieveClineAuthInfoStub.rejects(new AuthInvalidTokenError("invalid or expired token"))

			const token = await service.getAuthToken()
			await flushTelemetry()

			expect(token).to.be.null
			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.TOKEN_INVALID])
		})

		it("reports nothing on transient network failures", async () => {
			retrieveClineAuthInfoStub.rejects(new AuthNetworkError("status: 503"))

			const token = await service.getAuthToken()
			await flushTelemetry()

			expect(token).to.be.null
			expect(capturedLoggedOut.called).to.be.false
		})

		it("reports token_invalid via the provider breadcrumb without changing auth state", async () => {
			// Real ClineAuthProvider path: invalid refresh is swallowed into null
			// with the breadcrumb set. Telemetry fires; behavior is unchanged
			// (state keeps the stale session exactly as before this change).
			retrieveClineAuthInfoStub.resolves(null)
			;(service as any)._provider.lastRetrieveFailure = LogoutReason.TOKEN_INVALID

			const token = await service.getAuthToken()
			await flushTelemetry()

			expect(token).to.be.null
			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.TOKEN_INVALID])
			expect((service as any)._authenticated).to.be.true
			expect((service as any)._clineAuthInfo).to.not.be.null
		})
	})

	describe("ClineAuthProvider retrieve-failure breadcrumb", () => {
		const makeController = (storedAuthData: string | undefined): Controller =>
			({
				stateManager: {
					getSecretKey: () => storedAuthData,
					setSecret: () => {},
				},
			}) as unknown as Controller

		it("stays unset when there is no stored session", async () => {
			const provider = new ClineAuthProvider()

			const result = await provider.retrieveClineAuthInfo(makeController(undefined))

			expect(result).to.be.null
			expect(provider.lastRetrieveFailure).to.be.null
		})

		it("records restore_error for malformed stored auth data", async () => {
			const provider = new ClineAuthProvider()

			const result = await provider.retrieveClineAuthInfo(makeController("not-json{"))

			expect(result).to.be.null
			expect(provider.lastRetrieveFailure).to.equal(LogoutReason.RESTORE_ERROR)
		})

		it("records restore_error when stored auth data is missing tokens", async () => {
			const provider = new ClineAuthProvider()

			const result = await provider.retrieveClineAuthInfo(makeController(JSON.stringify({ userInfo: {} })))

			expect(result).to.be.null
			expect(provider.lastRetrieveFailure).to.equal(LogoutReason.RESTORE_ERROR)
		})
	})
})
