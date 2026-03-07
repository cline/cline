import { OpenAIAuthState, OpenAIUserInfo } from "@shared/proto/index.cline"
import * as assert from "assert"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import { OpenAIAuthService } from "../OpenAIAuthService"
import { OpenAIAuthProvider } from "../providers/OpenAIAuthProvider"

describe("OpenAIAuthService", () => {
	let sandbox: sinon.SinonSandbox
	let mockController: any
	let mockProvider: any
	let service: OpenAIAuthService

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Reset singleton state
		;(OpenAIAuthService as any).instance = null

		// Create mock controller
		mockController = {
			stateManager: {
				getSecretKey: sandbox.stub(),
				setSecret: sandbox.stub(),
				getGlobalSettingsKey: sandbox.stub(),
			},
			postStateToWebview: sandbox.stub().resolves(),
		}

		// Create mock provider
		mockProvider = sandbox.createStubInstance(OpenAIAuthProvider)

		// Stub Logger to avoid console noise during tests
		sandbox.stub(Logger, "debug")
		sandbox.stub(Logger, "log")
		sandbox.stub(Logger, "warn")
		sandbox.stub(Logger, "error")
	})

	afterEach(() => {
		sandbox.restore()
		;(OpenAIAuthService as any).instance = null
	})

	describe("Singleton Pattern", () => {
		it("should initialize singleton with controller", () => {
			const instance = OpenAIAuthService.initialize(mockController)
			assert.ok(instance)
			assert.strictEqual((instance as any)._controller, mockController)
		})

		it("should return same instance on multiple initialize calls", () => {
			const instance1 = OpenAIAuthService.initialize(mockController)
			const instance2 = OpenAIAuthService.initialize(mockController)
			assert.strictEqual(instance1, instance2)
		})

		it("should throw error when getInstance called before initialize", () => {
			assert.throws(() => {
				OpenAIAuthService.getInstance()
			}, /OpenAIAuthService not initialized/)
		})

		it("should return instance when getInstance called after initialize", () => {
			OpenAIAuthService.initialize(mockController)
			const instance = OpenAIAuthService.getInstance()
			assert.ok(instance)
		})
	})

	describe("getInfo()", () => {
		beforeEach(() => {
			service = OpenAIAuthService.initialize(mockController)
		})

		it("should return empty auth state when not authenticated", () => {
			const info = service.getInfo()
			assert.ok(info)
			assert.ok(!info.user || !info.user.uid)
		})

		it("should return user info when authenticated", () => {
			const mockUser: OpenAIUserInfo = {
				uid: "test-uid-123",
				displayName: "Test User",
				email: "test@example.com",
			}
			;(service as any)._openAIAuthState = { user: mockUser, apiKey: "test-token" }
			;(service as any)._authenticated = true

			const info = service.getInfo()
			assert.ok(info)
			assert.strictEqual(info.user?.uid, "test-uid-123")
			assert.strictEqual(info.user?.displayName, "Test User")
			assert.strictEqual(info.user?.email, "test@example.com")
		})

		it("should return empty state when authenticated flag is false", () => {
			;(service as any)._openAIAuthState = {
				user: { uid: "test-uid", displayName: "Test", email: "test@test.com" },
				apiKey: "token",
			}
			;(service as any)._authenticated = false

			const info = service.getInfo()
			assert.ok(!info.user || !info.user.uid)
		})
	})

	describe("isAuthenticated", () => {
		beforeEach(() => {
			service = OpenAIAuthService.initialize(mockController)
		})

		it("should return false by default", () => {
			assert.strictEqual(service.isAuthenticated, false)
		})

		it("should return true when authentication succeeds", () => {
			;(service as any)._authenticated = true
			assert.strictEqual(service.isAuthenticated, true)
		})
	})

	describe("getAuthToken()", () => {
		beforeEach(() => {
			service = OpenAIAuthService.initialize(mockController)
			;(service as any)._provider = mockProvider
		})

		it("should return null when no auth state exists", async () => {
			mockProvider.retrieveOpenAIAuthState.resolves(null)

			const token = await service.getAuthToken()
			assert.strictEqual(token, null)
		})

		it("should return access token from auth state", async () => {
			const mockAuthState: OpenAIAuthState = {
				user: { uid: "test-uid", displayName: "Test", email: "test@test.com" },
				apiKey: "test-access-token",
			}
			mockProvider.retrieveOpenAIAuthState.resolves(mockAuthState)

			const token = await service.getAuthToken()
			assert.strictEqual(token, "test-access-token")
		})

		it("should attempt refresh on first call", async () => {
			mockProvider.retrieveOpenAIAuthState.resolves(null)

			await service.getAuthToken()
			assert.ok(mockProvider.retrieveOpenAIAuthState.called)
		})
	})

	describe("handleAuthCallback()", () => {
		beforeEach(() => {
			service = OpenAIAuthService.initialize(mockController)
			;(service as any)._provider = mockProvider
		})

		it("should sign in with authorization code and update state", async () => {
			const mockAuthState: OpenAIAuthState = {
				user: { uid: "test-uid", displayName: "Test User", email: "test@test.com" },
				apiKey: "new-access-token",
			}
			mockProvider.signIn.resolves(mockAuthState)

			await service.handleAuthCallback("auth-code-123", "state-456")

			assert.ok(mockProvider.signIn.calledWith(mockController, "auth-code-123", "state-456"))
			assert.strictEqual(service.isAuthenticated, true)
			assert.strictEqual((service as any)._openAIAuthState, mockAuthState)
		})

		it("should throw error if sign in fails", async () => {
			mockProvider.signIn.rejects(new Error("Invalid authorization code"))

			await assert.rejects(async () => {
				await service.handleAuthCallback("bad-code", "bad-state")
			}, /Invalid authorization code/)
		})
	})

	describe("handleDeauth()", () => {
		beforeEach(() => {
			service = OpenAIAuthService.initialize(mockController)
			;(service as any)._provider = mockProvider
			;(service as any)._authenticated = true
			;(service as any)._openAIAuthState = {
				user: { uid: "test", displayName: "Test", email: "test@test.com" },
				apiKey: "token",
			}
		})

		it("should clear authentication state", async () => {
			await service.handleDeauth()

			assert.strictEqual(service.isAuthenticated, false)
			assert.strictEqual((service as any)._openAIAuthState, null)
			assert.ok(mockProvider.clearAuth.calledWith(mockController))
		})

		it("should throw error if logout fails", async () => {
			mockProvider.clearAuth.throws(new Error("Clear auth failed"))

			await assert.rejects(async () => {
				await service.handleDeauth()
			}, /Clear auth failed/)
		})
	})

	describe("restoreRefreshTokenAndRetrieveAuthInfo()", () => {
		beforeEach(() => {
			service = OpenAIAuthService.initialize(mockController)
			;(service as any)._provider = mockProvider
		})

		it("should restore auth state from stored refresh token", async () => {
			const mockAuthState: OpenAIAuthState = {
				user: { uid: "test-uid", displayName: "Restored User", email: "restored@test.com" },
				apiKey: "restored-token",
			}
			mockProvider.retrieveOpenAIAuthState.resolves(mockAuthState)

			await service.restoreRefreshTokenAndRetrieveAuthInfo()

			assert.strictEqual(service.isAuthenticated, true)
			assert.strictEqual((service as any)._openAIAuthState, mockAuthState)
		})

		it("should handle case when no refresh token exists", async () => {
			mockProvider.retrieveOpenAIAuthState.resolves(null)

			// Stub triggerAuth to avoid opening browser and prevent interactive login timeout
			sandbox.stub(service, "createAuthRequest" as any).resolves("https://auth.url")
			// Set _interactiveLoginPending to true to prevent kickstartInteractiveLoginAsFallback
			;(service as any)._interactiveLoginPending = true

			await service.restoreRefreshTokenAndRetrieveAuthInfo()

			assert.strictEqual(service.isAuthenticated, false)
		})
	})

	describe("subscribeToAuthStatusUpdate()", () => {
		beforeEach(() => {
			service = OpenAIAuthService.initialize(mockController)
			;(service as any)._provider = mockProvider
		})

		it("should add subscription and send initial status", async () => {
			const mockResponseStream = sandbox.stub().resolves()
			mockProvider.getExistingAuthState.resolves(null)

			await service.subscribeToAuthStatusUpdate({}, mockResponseStream)

			assert.strictEqual((service as any)._activeAuthStatusUpdateSubscriptions.size, 1)
			assert.ok(mockResponseStream.called)
		})

		it("should send authenticated state to new subscriber", async () => {
			const mockAuthState: OpenAIAuthState = {
				user: { uid: "test", displayName: "Test", email: "test@test.com" },
				apiKey: "token",
			}
			mockProvider.getExistingAuthState.resolves(mockAuthState)

			const mockResponseStream = sandbox.stub().resolves()

			await service.subscribeToAuthStatusUpdate({}, mockResponseStream)

			assert.ok(mockResponseStream.calledOnce)
		})
	})
})
