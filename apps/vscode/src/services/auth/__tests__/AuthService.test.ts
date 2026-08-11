/**
 * Tests for AuthService logout-reason telemetry.
 *
 * `user.auth_logged_out` used to report LogoutReason.ERROR_RECOVERY for three
 * very different situations (startup with no stored session, refresh token
 * rejected, restore throwing). These tests pin down the honest reason mapping:
 *   - no stored session on activation  -> no_stored_session (not a logout)
 *   - stored session destroyed         -> token_invalid (real involuntary logout)
 *   - session intact, transient null   -> no event at all
 *   - restore threw                    -> restore_error
 */

import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { Controller } from "@/core/controller"
import { resetTelemetryService } from "@/services/telemetry"
import { TelemetryService } from "@/services/telemetry/TelemetryService"
import { Logger } from "@/shared/services/Logger"
import { AuthInvalidTokenError, AuthNetworkError } from "../../error/ClineError"
import { AuthService, ClineAuthInfo } from "../AuthService"
import { LogoutReason } from "../types"

class TestableAuthService extends AuthService {
	constructor(controller: Controller) {
		super(controller)
	}
}

/**
 * The exported `telemetryService` is an async proxy that resolves the real
 * service lazily, so emissions land a few microtasks after the calling code
 * returns. Flush the event loop before asserting on the stub.
 */
async function flushTelemetry(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve))
	await new Promise((resolve) => setImmediate(resolve))
}

describe("AuthService logout telemetry reasons", () => {
	let sandbox: sinon.SinonSandbox
	let capturedLoggedOut: sinon.SinonStub
	let storedSecrets: Map<string, string | undefined>
	let mockController: Controller
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

		storedSecrets = new Map()
		mockController = {
			stateManager: {
				getSecretKey: (key: string) => storedSecrets.get(key),
				setSecret: (key: string, value: string | undefined) => {
					storedSecrets.set(key, value)
				},
			},
			postStateToWebview: sandbox.stub().resolves(),
		} as unknown as Controller

		service = new TestableAuthService(mockController)
		sandbox.stub(service, "sendAuthStatusUpdate").resolves()
		retrieveClineAuthInfoStub = sandbox.stub((service as any)._provider, "retrieveClineAuthInfo")
	})

	afterEach(() => {
		resetTelemetryService()
		sandbox.restore()
	})

	describe("restoreRefreshTokenAndRetrieveAuthInfo()", () => {
		it("reports no_stored_session when activation finds nothing in storage", async () => {
			// No secret stored at all: API-key users / never signed in.
			retrieveClineAuthInfoStub.resolves(null)

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await flushTelemetry()

			expect(capturedLoggedOut.calledOnce).to.be.true
			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.NO_STORED_SESSION])
		})

		it("reports token_invalid when the stored session was destroyed during restore", async () => {
			// A session existed, but the provider cleared it (invalid/expired
			// refresh token or unusable blob) before returning null.
			storedSecrets.set("cline:clineAccountId", JSON.stringify(authInfo))
			retrieveClineAuthInfoStub.callsFake(async () => {
				storedSecrets.set("cline:clineAccountId", undefined)
				return null
			})

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await flushTelemetry()

			expect(capturedLoggedOut.calledOnce).to.be.true
			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.TOKEN_INVALID])
		})

		it("reports nothing when the stored session survives a transient null (backoff / stand-down)", async () => {
			storedSecrets.set("cline:clineAccountId", JSON.stringify(authInfo))
			retrieveClineAuthInfoStub.resolves(null)

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await flushTelemetry()

			expect(capturedLoggedOut.called).to.be.false
			expect(await service.getAuthToken()).to.be.null
		})

		it("reports restore_error when restore throws", async () => {
			storedSecrets.set("cline:clineAccountId", JSON.stringify(authInfo))
			retrieveClineAuthInfoStub.rejects(new Error("secret storage unavailable"))

			await service.restoreRefreshTokenAndRetrieveAuthInfo()
			await flushTelemetry()

			expect(capturedLoggedOut.calledOnce).to.be.true
			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.RESTORE_ERROR])
		})

		it("reports nothing when restore succeeds", async () => {
			storedSecrets.set("cline:clineAccountId", JSON.stringify(authInfo))
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
			expect(capturedLoggedOut.calledOnce).to.be.true
			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.TOKEN_INVALID])
		})

		it("reports nothing on transient network failures", async () => {
			retrieveClineAuthInfoStub.rejects(new AuthNetworkError("status: 503"))

			const token = await service.getAuthToken()
			await flushTelemetry()

			expect(token).to.be.null
			expect(capturedLoggedOut.called).to.be.false
		})
	})

	describe("handleDeauth()", () => {
		it("keeps user_initiated as-is", async () => {
			await service.handleDeauth(LogoutReason.USER_INITIATED)
			await flushTelemetry()

			expect(capturedLoggedOut.calledOnce).to.be.true
			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.USER_INITIATED])
		})

		it("keeps cross_window_sync as-is", async () => {
			await service.handleDeauth(LogoutReason.CROSS_WINDOW_SYNC)
			await flushTelemetry()

			expect(capturedLoggedOut.calledOnce).to.be.true
			expect(capturedLoggedOut.firstCall.args).to.deep.equal(["cline", LogoutReason.CROSS_WINDOW_SYNC])
		})
	})

	describe("LogoutReason vocabulary", () => {
		it("uses the values the warehouse queries rely on", () => {
			expect(LogoutReason.USER_INITIATED).to.equal("user_initiated")
			expect(LogoutReason.CROSS_WINDOW_SYNC).to.equal("cross_window_sync")
			expect(LogoutReason.TOKEN_INVALID).to.equal("token_invalid")
			expect(LogoutReason.NO_STORED_SESSION).to.equal("no_stored_session")
			expect(LogoutReason.RESTORE_ERROR).to.equal("restore_error")
			expect(LogoutReason.UNKNOWN).to.equal("unknown")
		})
	})
})
