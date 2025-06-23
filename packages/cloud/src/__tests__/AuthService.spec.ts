// npx vitest run src/__tests__/AuthService.spec.ts

import { vi, Mock, beforeEach, afterEach, describe, it, expect } from "vitest"
import crypto from "crypto"
import * as vscode from "vscode"

import { AuthService } from "../AuthService"
import { RefreshTimer } from "../RefreshTimer"
import * as Config from "../Config"
import * as utils from "../utils"

// Mock external dependencies
vi.mock("../RefreshTimer")
vi.mock("../Config")
vi.mock("../utils")
vi.mock("crypto")

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	env: {
		openExternal: vi.fn(),
		uriScheme: "vscode",
	},
	Uri: {
		parse: vi.fn((uri: string) => ({ toString: () => uri })),
	},
}))

describe("AuthService", () => {
	let authService: AuthService
	let mockTimer: {
		start: Mock
		stop: Mock
		reset: Mock
	}
	let mockLog: Mock
	let mockContext: {
		subscriptions: { push: Mock }
		secrets: {
			get: Mock
			store: Mock
			delete: Mock
			onDidChange: Mock
		}
		globalState: {
			get: Mock
			update: Mock
		}
		extension: {
			packageJSON: {
				version: string
				publisher: string
				name: string
			}
		}
	}

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Setup mock context with proper subscriptions array
		mockContext = {
			subscriptions: {
				push: vi.fn(),
			},
			secrets: {
				get: vi.fn().mockResolvedValue(undefined),
				store: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined),
				onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			},
			globalState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
			},
			extension: {
				packageJSON: {
					version: "1.0.0",
					publisher: "RooVeterinaryInc",
					name: "roo-cline",
				},
			},
		}

		// Setup timer mock
		mockTimer = {
			start: vi.fn(),
			stop: vi.fn(),
			reset: vi.fn(),
		}
		vi.mocked(RefreshTimer).mockImplementation(() => mockTimer as unknown as RefreshTimer)

		// Setup config mocks - use production URL by default to maintain existing test behavior
		vi.mocked(Config.getClerkBaseUrl).mockReturnValue("https://clerk.roocode.com")
		vi.mocked(Config.getRooCodeApiUrl).mockReturnValue("https://api.test.com")

		// Setup utils mock
		vi.mocked(utils.getUserAgent).mockReturnValue("Roo-Code 1.0.0")

		// Setup crypto mock
		vi.mocked(crypto.randomBytes).mockReturnValue(Buffer.from("test-random-bytes") as never)

		// Setup log mock
		mockLog = vi.fn()

		authService = new AuthService(mockContext as unknown as vscode.ExtensionContext, mockLog)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with correct default values", () => {
			expect(authService.getState()).toBe("initializing")
			expect(authService.isAuthenticated()).toBe(false)
			expect(authService.hasActiveSession()).toBe(false)
			expect(authService.getSessionToken()).toBeUndefined()
			expect(authService.getUserInfo()).toBeNull()
		})

		it("should create RefreshTimer with correct configuration", () => {
			expect(RefreshTimer).toHaveBeenCalledWith({
				callback: expect.any(Function),
				successInterval: 50_000,
				initialBackoffMs: 1_000,
				maxBackoffMs: 300_000,
			})
		})

		it("should use console.log as default logger", () => {
			const serviceWithoutLog = new AuthService(mockContext as unknown as vscode.ExtensionContext)
			// Can't directly test console.log usage, but constructor should not throw
			expect(serviceWithoutLog).toBeInstanceOf(AuthService)
		})
	})

	describe("initialize", () => {
		it("should handle credentials change and setup event listener", async () => {
			await authService.initialize()

			expect(mockContext.subscriptions.push).toHaveBeenCalled()
			expect(mockContext.secrets.onDidChange).toHaveBeenCalled()
		})

		it("should not initialize twice", async () => {
			await authService.initialize()
			const firstCallCount = vi.mocked(mockContext.secrets.onDidChange).mock.calls.length

			await authService.initialize()
			expect(mockContext.secrets.onDidChange).toHaveBeenCalledTimes(firstCallCount)
			expect(mockLog).toHaveBeenCalledWith("[auth] initialize() called after already initialized")
		})

		it("should transition to logged-out when no credentials exist", async () => {
			mockContext.secrets.get.mockResolvedValue(undefined)

			const loggedOutSpy = vi.fn()
			authService.on("logged-out", loggedOutSpy)

			await authService.initialize()

			expect(authService.getState()).toBe("logged-out")
			expect(loggedOutSpy).toHaveBeenCalledWith({ previousState: "initializing" })
		})

		it("should transition to attempting-session when valid credentials exist", async () => {
			const credentials = { clientToken: "test-token", sessionId: "test-session" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))

			const attemptingSessionSpy = vi.fn()
			authService.on("attempting-session", attemptingSessionSpy)

			await authService.initialize()

			expect(authService.getState()).toBe("attempting-session")
			expect(attemptingSessionSpy).toHaveBeenCalledWith({ previousState: "initializing" })
			expect(mockTimer.start).toHaveBeenCalled()
		})

		it("should handle invalid credentials gracefully", async () => {
			mockContext.secrets.get.mockResolvedValue("invalid-json")

			const loggedOutSpy = vi.fn()
			authService.on("logged-out", loggedOutSpy)

			await authService.initialize()

			expect(authService.getState()).toBe("logged-out")
			expect(mockLog).toHaveBeenCalledWith("[auth] Failed to parse stored credentials:", expect.any(Error))
		})

		it("should handle credentials change events", async () => {
			let onDidChangeCallback: (e: { key: string }) => void

			mockContext.secrets.onDidChange.mockImplementation((callback: (e: { key: string }) => void) => {
				onDidChangeCallback = callback
				return { dispose: vi.fn() }
			})

			await authService.initialize()

			// Simulate credentials change event
			const newCredentials = { clientToken: "new-token", sessionId: "new-session" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(newCredentials))

			const attemptingSessionSpy = vi.fn()
			authService.on("attempting-session", attemptingSessionSpy)

			onDidChangeCallback!({ key: "clerk-auth-credentials" })
			await new Promise((resolve) => setTimeout(resolve, 0)) // Wait for async handling

			expect(attemptingSessionSpy).toHaveBeenCalled()
		})
	})

	describe("login", () => {
		beforeEach(async () => {
			await authService.initialize()
		})

		it("should generate state and open external URL", async () => {
			const mockOpenExternal = vi.fn()
			const vscode = await import("vscode")
			vi.mocked(vscode.env.openExternal).mockImplementation(mockOpenExternal)

			await authService.login()

			expect(crypto.randomBytes).toHaveBeenCalledWith(16)
			expect(mockContext.globalState.update).toHaveBeenCalledWith(
				"clerk-auth-state",
				"746573742d72616e646f6d2d6279746573",
			)
			expect(mockOpenExternal).toHaveBeenCalledWith(
				expect.objectContaining({
					toString: expect.any(Function),
				}),
			)
		})

		it("should use package.json values for redirect URI", async () => {
			const mockOpenExternal = vi.fn()
			const vscode = await import("vscode")
			vi.mocked(vscode.env.openExternal).mockImplementation(mockOpenExternal)

			await authService.login()

			const expectedUrl =
				"https://api.test.com/extension/sign-in?state=746573742d72616e646f6d2d6279746573&auth_redirect=vscode%3A%2F%2FRooVeterinaryInc.roo-cline"
			expect(mockOpenExternal).toHaveBeenCalledWith(
				expect.objectContaining({
					toString: expect.any(Function),
				}),
			)

			// Verify the actual URL
			const calledUri = mockOpenExternal.mock.calls[0][0]
			expect(calledUri.toString()).toBe(expectedUrl)
		})

		it("should handle errors during login", async () => {
			vi.mocked(crypto.randomBytes).mockImplementation(() => {
				throw new Error("Crypto error")
			})

			await expect(authService.login()).rejects.toThrow("Failed to initiate Roo Code Cloud authentication")
			expect(mockLog).toHaveBeenCalledWith("[auth] Error initiating Roo Code Cloud auth: Error: Crypto error")
		})
	})

	describe("handleCallback", () => {
		beforeEach(async () => {
			await authService.initialize()
		})

		it("should handle invalid parameters", async () => {
			const vscode = await import("vscode")
			const mockShowInfo = vi.fn()
			vi.mocked(vscode.window.showInformationMessage).mockImplementation(mockShowInfo)

			await authService.handleCallback(null, "state")
			expect(mockShowInfo).toHaveBeenCalledWith("Invalid Roo Code Cloud sign in url")

			await authService.handleCallback("code", null)
			expect(mockShowInfo).toHaveBeenCalledWith("Invalid Roo Code Cloud sign in url")
		})

		it("should validate state parameter", async () => {
			mockContext.globalState.get.mockReturnValue("stored-state")

			await expect(authService.handleCallback("code", "different-state")).rejects.toThrow(
				"Failed to handle Roo Code Cloud callback",
			)
			expect(mockLog).toHaveBeenCalledWith("[auth] State mismatch in callback")
		})

		it("should successfully handle valid callback", async () => {
			const storedState = "valid-state"
			mockContext.globalState.get.mockReturnValue(storedState)

			// Mock successful Clerk sign-in response
			const mockResponse = {
				ok: true,
				json: () =>
					Promise.resolve({
						response: { created_session_id: "session-123" },
					}),
				headers: {
					get: (header: string) => (header === "authorization" ? "Bearer token-123" : null),
				},
			}
			mockFetch.mockResolvedValue(mockResponse)

			const vscode = await import("vscode")
			const mockShowInfo = vi.fn()
			vi.mocked(vscode.window.showInformationMessage).mockImplementation(mockShowInfo)

			await authService.handleCallback("auth-code", storedState)

			expect(mockContext.secrets.store).toHaveBeenCalledWith(
				"clerk-auth-credentials",
				JSON.stringify({ clientToken: "Bearer token-123", sessionId: "session-123", organizationId: null }),
			)
			expect(mockShowInfo).toHaveBeenCalledWith("Successfully authenticated with Roo Code Cloud")
		})

		it("should handle Clerk API errors", async () => {
			const storedState = "valid-state"
			mockContext.globalState.get.mockReturnValue(storedState)

			mockFetch.mockResolvedValue({
				ok: false,
				status: 400,
				statusText: "Bad Request",
			})

			const loggedOutSpy = vi.fn()
			authService.on("logged-out", loggedOutSpy)

			await expect(authService.handleCallback("auth-code", storedState)).rejects.toThrow(
				"Failed to handle Roo Code Cloud callback",
			)
			expect(loggedOutSpy).toHaveBeenCalled()
		})
	})

	describe("logout", () => {
		beforeEach(async () => {
			await authService.initialize()
		})

		it("should clear credentials and call Clerk logout", async () => {
			// Set up credentials first by simulating a login state
			const credentials = { clientToken: "test-token", sessionId: "test-session" }

			// Manually set the credentials in the service
			authService["credentials"] = credentials

			// Mock successful logout response
			mockFetch.mockResolvedValue({ ok: true })

			const vscode = await import("vscode")
			const mockShowInfo = vi.fn()
			vi.mocked(vscode.window.showInformationMessage).mockImplementation(mockShowInfo)

			await authService.logout()

			expect(mockContext.secrets.delete).toHaveBeenCalledWith("clerk-auth-credentials")
			expect(mockContext.globalState.update).toHaveBeenCalledWith("clerk-auth-state", undefined)
			expect(mockFetch).toHaveBeenCalledWith(
				"https://clerk.roocode.com/v1/client/sessions/test-session/remove",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						Authorization: "Bearer test-token",
					}),
				}),
			)
			expect(mockShowInfo).toHaveBeenCalledWith("Logged out from Roo Code Cloud")
		})

		it("should handle logout without credentials", async () => {
			const vscode = await import("vscode")
			const mockShowInfo = vi.fn()
			vi.mocked(vscode.window.showInformationMessage).mockImplementation(mockShowInfo)

			await authService.logout()

			expect(mockContext.secrets.delete).toHaveBeenCalled()
			expect(mockFetch).not.toHaveBeenCalled()
			expect(mockShowInfo).toHaveBeenCalledWith("Logged out from Roo Code Cloud")
		})

		it("should handle Clerk logout errors gracefully", async () => {
			// Set up credentials first by simulating a login state
			const credentials = { clientToken: "test-token", sessionId: "test-session" }

			// Manually set the credentials in the service
			authService["credentials"] = credentials

			// Mock failed logout response
			mockFetch.mockRejectedValue(new Error("Network error"))

			const vscode = await import("vscode")
			const mockShowInfo = vi.fn()
			vi.mocked(vscode.window.showInformationMessage).mockImplementation(mockShowInfo)

			await authService.logout()

			expect(mockLog).toHaveBeenCalledWith("[auth] Error calling clerkLogout:", expect.any(Error))
			expect(mockShowInfo).toHaveBeenCalledWith("Logged out from Roo Code Cloud")
		})
	})

	describe("state management", () => {
		it("should return correct state", () => {
			expect(authService.getState()).toBe("initializing")
		})

		it("should return correct authentication status", async () => {
			await authService.initialize()
			expect(authService.isAuthenticated()).toBe(false)

			// Create a new service instance with credentials
			const credentials = { clientToken: "test-token", sessionId: "test-session" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))

			const authenticatedService = new AuthService(mockContext as unknown as vscode.ExtensionContext, mockLog)
			await authenticatedService.initialize()

			expect(authenticatedService.isAuthenticated()).toBe(true)
			expect(authenticatedService.hasActiveSession()).toBe(false)
		})

		it("should return session token only for active sessions", () => {
			expect(authService.getSessionToken()).toBeUndefined()

			// Manually set state to active-session for testing
			// This would normally happen through refreshSession
			authService["state"] = "active-session"
			authService["sessionToken"] = "test-jwt"

			expect(authService.getSessionToken()).toBe("test-jwt")
		})

		it("should return correct values for new methods", async () => {
			await authService.initialize()
			expect(authService.hasOrIsAcquiringActiveSession()).toBe(false)

			// Create a new service instance with credentials (attempting-session)
			const credentials = { clientToken: "test-token", sessionId: "test-session" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))

			const attemptingService = new AuthService(mockContext as unknown as vscode.ExtensionContext, mockLog)
			await attemptingService.initialize()

			expect(attemptingService.hasOrIsAcquiringActiveSession()).toBe(true)
			expect(attemptingService.hasActiveSession()).toBe(false)

			// Manually set state to active-session for testing
			attemptingService["state"] = "active-session"
			expect(attemptingService.hasOrIsAcquiringActiveSession()).toBe(true)
			expect(attemptingService.hasActiveSession()).toBe(true)
		})
	})

	describe("session refresh", () => {
		beforeEach(async () => {
			// Set up with credentials
			const credentials = { clientToken: "test-token", sessionId: "test-session" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))
			await authService.initialize()
		})

		it("should refresh session successfully", async () => {
			// Mock successful token creation and user info fetch
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ jwt: "new-jwt-token" }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							response: {
								first_name: "John",
								last_name: "Doe",
								image_url: "https://example.com/avatar.jpg",
								primary_email_address_id: "email-1",
								email_addresses: [{ id: "email-1", email_address: "john@example.com" }],
							},
						}),
				})

			const activeSessionSpy = vi.fn()
			const userInfoSpy = vi.fn()
			authService.on("active-session", activeSessionSpy)
			authService.on("user-info", userInfoSpy)

			// Trigger refresh by calling the timer callback
			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0][0].callback
			await timerCallback()

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0))

			expect(authService.getState()).toBe("active-session")
			expect(authService.hasActiveSession()).toBe(true)
			expect(authService.getSessionToken()).toBe("new-jwt-token")
			expect(activeSessionSpy).toHaveBeenCalledWith({ previousState: "attempting-session" })
			expect(userInfoSpy).toHaveBeenCalledWith({
				userInfo: {
					name: "John Doe",
					email: "john@example.com",
					picture: "https://example.com/avatar.jpg",
				},
			})
		})

		it("should handle invalid client token error", async () => {
			// Mock 401 response (invalid token)
			mockFetch.mockResolvedValue({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
			})

			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0][0].callback

			await expect(timerCallback()).rejects.toThrow()
			expect(mockContext.secrets.delete).toHaveBeenCalledWith("clerk-auth-credentials")
			expect(mockLog).toHaveBeenCalledWith("[auth] Invalid/Expired client token: clearing credentials")
		})

		it("should handle network errors during refresh", async () => {
			mockFetch.mockRejectedValue(new Error("Network error"))

			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0][0].callback

			await expect(timerCallback()).rejects.toThrow("Network error")
			expect(mockLog).toHaveBeenCalledWith("[auth] Failed to refresh session", expect.any(Error))
		})

		it("should transition to inactive-session on first attempt failure", async () => {
			// Mock failed token creation response
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			})

			const inactiveSessionSpy = vi.fn()
			authService.on("inactive-session", inactiveSessionSpy)

			// Verify we start in attempting-session state
			expect(authService.getState()).toBe("attempting-session")
			expect(authService["isFirstRefreshAttempt"]).toBe(true)

			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0][0].callback

			await expect(timerCallback()).rejects.toThrow()

			// Should transition to inactive-session after first failure
			expect(authService.getState()).toBe("inactive-session")
			expect(authService["isFirstRefreshAttempt"]).toBe(false)
			expect(inactiveSessionSpy).toHaveBeenCalledWith({ previousState: "attempting-session" })
		})

		it("should not transition to inactive-session on subsequent failures", async () => {
			// First, transition to inactive-session by failing the first attempt
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			})

			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0][0].callback
			await expect(timerCallback()).rejects.toThrow()

			// Verify we're now in inactive-session
			expect(authService.getState()).toBe("inactive-session")
			expect(authService["isFirstRefreshAttempt"]).toBe(false)

			const inactiveSessionSpy = vi.fn()
			authService.on("inactive-session", inactiveSessionSpy)

			// Subsequent failure should not trigger another transition
			await expect(timerCallback()).rejects.toThrow()

			expect(authService.getState()).toBe("inactive-session")
			expect(inactiveSessionSpy).not.toHaveBeenCalled()
		})

		it("should clear credentials on 401 during first refresh attempt (bug fix)", async () => {
			// Mock 401 response during first refresh attempt
			mockFetch.mockResolvedValue({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
			})

			const loggedOutSpy = vi.fn()
			authService.on("logged-out", loggedOutSpy)

			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0][0].callback
			await expect(timerCallback()).rejects.toThrow()

			// Should clear credentials (not just transition to inactive-session)
			expect(mockContext.secrets.delete).toHaveBeenCalledWith("clerk-auth-credentials")
			expect(mockLog).toHaveBeenCalledWith("[auth] Invalid/Expired client token: clearing credentials")

			// Simulate credentials cleared event
			mockContext.secrets.get.mockResolvedValue(undefined)
			await authService["handleCredentialsChange"]()

			expect(authService.getState()).toBe("logged-out")
			expect(loggedOutSpy).toHaveBeenCalledWith({ previousState: "attempting-session" })
		})
	})

	describe("user info", () => {
		it("should return null initially", () => {
			expect(authService.getUserInfo()).toBeNull()
		})

		it("should parse user info correctly for personal accounts", async () => {
			// Set up with credentials for personal account (no organizationId)
			const credentials = { clientToken: "test-token", sessionId: "test-session", organizationId: null }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))
			await authService.initialize()

			// Clear previous mock calls
			mockFetch.mockClear()

			// Mock successful responses
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ jwt: "jwt-token" }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							response: {
								first_name: "Jane",
								last_name: "Smith",
								image_url: "https://example.com/jane.jpg",
								primary_email_address_id: "email-2",
								email_addresses: [
									{ id: "email-1", email_address: "jane.old@example.com" },
									{ id: "email-2", email_address: "jane@example.com" },
								],
							},
						}),
				})

			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0][0].callback
			await timerCallback()

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0))

			const userInfo = authService.getUserInfo()
			expect(userInfo).toEqual({
				name: "Jane Smith",
				email: "jane@example.com",
				picture: "https://example.com/jane.jpg",
			})
		})

		it("should parse user info correctly for organization accounts", async () => {
			// Set up with credentials for organization account
			const credentials = { clientToken: "test-token", sessionId: "test-session", organizationId: "org_1" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))
			await authService.initialize()

			// Clear previous mock calls
			mockFetch.mockClear()

			// Mock successful responses
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ jwt: "jwt-token" }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							response: {
								first_name: "Jane",
								last_name: "Smith",
								image_url: "https://example.com/jane.jpg",
								primary_email_address_id: "email-2",
								email_addresses: [
									{ id: "email-1", email_address: "jane.old@example.com" },
									{ id: "email-2", email_address: "jane@example.com" },
								],
							},
						}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							response: [
								{
									id: "org_member_id_1",
									role: "member",
									organization: {
										id: "org_1",
										name: "Org 1",
									},
								},
							],
						}),
				})

			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0][0].callback
			await timerCallback()

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0))

			const userInfo = authService.getUserInfo()
			expect(userInfo).toEqual({
				name: "Jane Smith",
				email: "jane@example.com",
				picture: "https://example.com/jane.jpg",
				organizationId: "org_1",
				organizationName: "Org 1",
				organizationRole: "member",
			})
		})

		it("should handle missing user info fields", async () => {
			// Set up with credentials for personal account (no organizationId)
			const credentials = { clientToken: "test-token", sessionId: "test-session", organizationId: null }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))
			await authService.initialize()

			// Clear previous mock calls
			mockFetch.mockClear()

			// Mock responses with minimal data
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ jwt: "jwt-token" }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							response: {
								first_name: "John",
								last_name: "Doe",
								// Missing other fields
							},
						}),
				})

			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0][0].callback
			await timerCallback()

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0))

			const userInfo = authService.getUserInfo()
			expect(userInfo).toEqual({
				name: "John Doe",
				email: undefined,
				picture: undefined,
			})
		})
	})

	describe("event emissions", () => {
		it("should emit logged-out event", async () => {
			const loggedOutSpy = vi.fn()
			authService.on("logged-out", loggedOutSpy)

			await authService.initialize()

			expect(loggedOutSpy).toHaveBeenCalledWith({ previousState: "initializing" })
		})

		it("should emit attempting-session event", async () => {
			const credentials = { clientToken: "test-token", sessionId: "test-session" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))

			const attemptingSessionSpy = vi.fn()
			authService.on("attempting-session", attemptingSessionSpy)

			await authService.initialize()

			expect(attemptingSessionSpy).toHaveBeenCalledWith({ previousState: "initializing" })
		})

		it("should emit active-session event", async () => {
			// Set up with credentials
			const credentials = { clientToken: "test-token", sessionId: "test-session" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))
			await authService.initialize()

			// Clear previous mock calls
			mockFetch.mockClear()

			// Mock both the token creation and user info fetch
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ jwt: "jwt-token" }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							response: {
								first_name: "Test",
								last_name: "User",
							},
						}),
				})

			const activeSessionSpy = vi.fn()
			authService.on("active-session", activeSessionSpy)

			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0][0].callback
			await timerCallback()

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0))

			expect(activeSessionSpy).toHaveBeenCalledWith({ previousState: "attempting-session" })
		})

		it("should emit user-info event", async () => {
			// Set up with credentials
			const credentials = { clientToken: "test-token", sessionId: "test-session" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))
			await authService.initialize()

			// Clear previous mock calls
			mockFetch.mockClear()

			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ jwt: "jwt-token" }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							response: {
								first_name: "Test",
								last_name: "User",
							},
						}),
				})

			const userInfoSpy = vi.fn()
			authService.on("user-info", userInfoSpy)

			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0][0].callback
			await timerCallback()

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 0))

			expect(userInfoSpy).toHaveBeenCalledWith({
				userInfo: {
					name: "Test User",
					email: undefined,
					picture: undefined,
				},
			})
		})
	})

	describe("error handling", () => {
		it("should handle credentials change errors", async () => {
			mockContext.secrets.get.mockRejectedValue(new Error("Storage error"))

			await authService.initialize()

			expect(mockLog).toHaveBeenCalledWith("[auth] Error handling credentials change:", expect.any(Error))
		})

		it("should handle malformed JSON in credentials", async () => {
			mockContext.secrets.get.mockResolvedValue("invalid-json{")

			await authService.initialize()

			expect(authService.getState()).toBe("logged-out")
			expect(mockLog).toHaveBeenCalledWith("[auth] Failed to parse stored credentials:", expect.any(Error))
		})

		it("should handle invalid credentials schema", async () => {
			mockContext.secrets.get.mockResolvedValue(JSON.stringify({ invalid: "data" }))

			await authService.initialize()

			expect(authService.getState()).toBe("logged-out")
			expect(mockLog).toHaveBeenCalledWith("[auth] Invalid credentials format:", expect.any(Array))
		})

		it("should handle missing authorization header in sign-in response", async () => {
			const storedState = "valid-state"
			mockContext.globalState.get.mockReturnValue(storedState)

			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						response: { created_session_id: "session-123" },
					}),
				headers: {
					get: () => null, // No authorization header
				},
			})

			await expect(authService.handleCallback("auth-code", storedState)).rejects.toThrow(
				"Failed to handle Roo Code Cloud callback",
			)
		})
	})

	describe("timer integration", () => {
		it("should stop timer on logged-out transition", async () => {
			await authService.initialize()

			expect(mockTimer.stop).toHaveBeenCalled()
		})

		it("should start timer on attempting-session transition", async () => {
			const credentials = { clientToken: "test-token", sessionId: "test-session" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))

			await authService.initialize()

			expect(mockTimer.start).toHaveBeenCalled()
		})
	})

	describe("auth credentials key scoping", () => {
		it("should use default key when getClerkBaseUrl returns production URL", async () => {
			// Mock getClerkBaseUrl to return production URL
			vi.mocked(Config.getClerkBaseUrl).mockReturnValue("https://clerk.roocode.com")

			const service = new AuthService(mockContext as unknown as vscode.ExtensionContext, mockLog)
			const credentials = { clientToken: "test-token", sessionId: "test-session" }

			await service.initialize()
			await service["storeCredentials"](credentials)

			expect(mockContext.secrets.store).toHaveBeenCalledWith(
				"clerk-auth-credentials",
				JSON.stringify(credentials),
			)
		})

		it("should use scoped key when getClerkBaseUrl returns custom URL", async () => {
			const customUrl = "https://custom.clerk.com"
			// Mock getClerkBaseUrl to return custom URL
			vi.mocked(Config.getClerkBaseUrl).mockReturnValue(customUrl)

			const service = new AuthService(mockContext as unknown as vscode.ExtensionContext, mockLog)
			const credentials = { clientToken: "test-token", sessionId: "test-session" }

			await service.initialize()
			await service["storeCredentials"](credentials)

			expect(mockContext.secrets.store).toHaveBeenCalledWith(
				`clerk-auth-credentials-${customUrl}`,
				JSON.stringify(credentials),
			)
		})

		it("should load credentials using scoped key", async () => {
			const customUrl = "https://custom.clerk.com"
			vi.mocked(Config.getClerkBaseUrl).mockReturnValue(customUrl)

			const service = new AuthService(mockContext as unknown as vscode.ExtensionContext, mockLog)
			const credentials = { clientToken: "test-token", sessionId: "test-session" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(credentials))

			await service.initialize()
			const loadedCredentials = await service["loadCredentials"]()

			expect(mockContext.secrets.get).toHaveBeenCalledWith(`clerk-auth-credentials-${customUrl}`)
			expect(loadedCredentials).toEqual(credentials)
		})

		it("should clear credentials using scoped key", async () => {
			const customUrl = "https://custom.clerk.com"
			vi.mocked(Config.getClerkBaseUrl).mockReturnValue(customUrl)

			const service = new AuthService(mockContext as unknown as vscode.ExtensionContext, mockLog)

			await service.initialize()
			await service["clearCredentials"]()

			expect(mockContext.secrets.delete).toHaveBeenCalledWith(`clerk-auth-credentials-${customUrl}`)
		})

		it("should listen for changes on scoped key", async () => {
			const customUrl = "https://custom.clerk.com"
			vi.mocked(Config.getClerkBaseUrl).mockReturnValue(customUrl)

			let onDidChangeCallback: (e: { key: string }) => void

			mockContext.secrets.onDidChange.mockImplementation((callback: (e: { key: string }) => void) => {
				onDidChangeCallback = callback
				return { dispose: vi.fn() }
			})

			const service = new AuthService(mockContext as unknown as vscode.ExtensionContext, mockLog)
			await service.initialize()

			// Simulate credentials change event with scoped key
			const newCredentials = { clientToken: "new-token", sessionId: "new-session" }
			mockContext.secrets.get.mockResolvedValue(JSON.stringify(newCredentials))

			const attemptingSessionSpy = vi.fn()
			service.on("attempting-session", attemptingSessionSpy)

			onDidChangeCallback!({ key: `clerk-auth-credentials-${customUrl}` })
			await new Promise((resolve) => setTimeout(resolve, 0)) // Wait for async handling

			expect(attemptingSessionSpy).toHaveBeenCalled()
		})

		it("should not respond to changes on different scoped keys", async () => {
			const customUrl = "https://custom.clerk.com"
			vi.mocked(Config.getClerkBaseUrl).mockReturnValue(customUrl)

			let onDidChangeCallback: (e: { key: string }) => void

			mockContext.secrets.onDidChange.mockImplementation((callback: (e: { key: string }) => void) => {
				onDidChangeCallback = callback
				return { dispose: vi.fn() }
			})

			const service = new AuthService(mockContext as unknown as vscode.ExtensionContext, mockLog)
			await service.initialize()

			const inactiveSessionSpy = vi.fn()
			service.on("inactive-session", inactiveSessionSpy)

			// Simulate credentials change event with different scoped key
			onDidChangeCallback!({ key: "clerk-auth-credentials-https://other.clerk.com" })
			await new Promise((resolve) => setTimeout(resolve, 0)) // Wait for async handling

			expect(inactiveSessionSpy).not.toHaveBeenCalled()
		})

		it("should not respond to changes on default key when using scoped key", async () => {
			const customUrl = "https://custom.clerk.com"
			vi.mocked(Config.getClerkBaseUrl).mockReturnValue(customUrl)

			let onDidChangeCallback: (e: { key: string }) => void

			mockContext.secrets.onDidChange.mockImplementation((callback: (e: { key: string }) => void) => {
				onDidChangeCallback = callback
				return { dispose: vi.fn() }
			})

			const service = new AuthService(mockContext as unknown as vscode.ExtensionContext, mockLog)
			await service.initialize()

			const inactiveSessionSpy = vi.fn()
			service.on("inactive-session", inactiveSessionSpy)

			// Simulate credentials change event with default key
			onDidChangeCallback!({ key: "clerk-auth-credentials" })
			await new Promise((resolve) => setTimeout(resolve, 0)) // Wait for async handling

			expect(inactiveSessionSpy).not.toHaveBeenCalled()
		})
	})
})
