import { StateManager } from "@core/storage/StateManager"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import * as envUtils from "@/utils/env"
import { getServerAuthHash } from "@/utils/mcpAuth"
import { McpOAuthManager } from "../McpOAuthManager"

describe("McpOAuthManager", () => {
	let sandbox: sinon.SinonSandbox
	let mockStateManager: {
		getSecretKey: sinon.SinonStub
		setSecret: sinon.SinonStub
	}
	let storedSecrets: Record<string, string>

	beforeEach(async () => {
		sandbox = sinon.createSandbox()

		// Initialize storage for secrets
		storedSecrets = {}

		// Mock StateManager
		mockStateManager = {
			getSecretKey: sandbox.stub().callsFake((key: string) => storedSecrets[key]),
			setSecret: sandbox.stub().callsFake((key: string, value: string) => {
				storedSecrets[key] = value
			}),
		}
		sandbox.stub(StateManager, "get").returns(mockStateManager as any)

		// Mock HostProvider for redirect URL
		setVscodeHostProviderMock({
			getCallbackUri: async () => "vscode://saoudrizwan.claude-dev",
		})

		// Mock openExternal to prevent actual browser opens
		sandbox.stub(envUtils, "openExternal").resolves()
	})

	afterEach(() => {
		sandbox.restore()
		HostProvider.reset()
	})

	describe("getOrCreateProvider", () => {
		it("should create a new provider for a server", async () => {
			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			expect(provider).to.exist
			expect(provider.redirectUrl).to.include("vscode://saoudrizwan.claude-dev")
			expect(provider.redirectUrl).to.include("/mcp-auth/callback/")
		})

		it("should return cached provider for same server", async () => {
			const manager = new McpOAuthManager()
			const provider1 = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")
			const provider2 = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			expect(provider1).to.equal(provider2)
		})

		it("should create different providers for different servers", async () => {
			const manager = new McpOAuthManager()
			const provider1 = await manager.getOrCreateProvider("server-1", "https://mcp1.example.com")
			const provider2 = await manager.getOrCreateProvider("server-2", "https://mcp2.example.com")

			expect(provider1).to.not.equal(provider2)
			expect(provider1.redirectUrl).to.not.equal(provider2.redirectUrl)
		})
	})

	describe("Provider - tokens()", () => {
		it("should return undefined when no tokens stored", async () => {
			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			const tokens = await provider.tokens()
			expect(tokens).to.be.undefined
		})

		it("should return stored tokens when valid", async () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")
			const mockTokens = {
				access_token: "test-access-token",
				token_type: "Bearer",
				expires_in: 3600,
				refresh_token: "test-refresh-token",
			}

			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					tokens: mockTokens,
					tokens_saved_at: Date.now(),
				},
			})

			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			const tokens = await provider.tokens()
			expect(tokens).to.deep.equal(mockTokens)
		})

		it("should return expired tokens if refresh_token exists (for SDK to refresh)", async () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")
			const mockTokens = {
				access_token: "expired-access-token",
				token_type: "Bearer",
				expires_in: 60, // 60 seconds
				refresh_token: "valid-refresh-token",
			}

			// Token saved 2 minutes ago (expired)
			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					tokens: mockTokens,
					tokens_saved_at: Date.now() - 120 * 1000,
				},
			})

			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			const tokens = await provider.tokens()
			// Should return expired tokens so SDK can attempt refresh
			expect(tokens).to.deep.equal(mockTokens)
		})

		it("should return undefined when token expired and no refresh_token", async () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")
			const mockTokens = {
				access_token: "expired-access-token",
				token_type: "Bearer",
				expires_in: 60, // 60 seconds
				// No refresh_token
			}

			// Token saved 2 minutes ago (expired)
			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					tokens: mockTokens,
					tokens_saved_at: Date.now() - 120 * 1000,
				},
			})

			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			const tokens = await provider.tokens()
			// Should return undefined to trigger full re-authentication
			expect(tokens).to.be.undefined
		})
	})

	describe("Provider - saveTokens()", () => {
		it("should save tokens with timestamp", async () => {
			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")

			const mockTokens = {
				access_token: "new-access-token",
				token_type: "Bearer",
				expires_in: 3600,
				refresh_token: "new-refresh-token",
			}

			await provider.saveTokens(mockTokens)

			const savedSecrets = JSON.parse(storedSecrets["mcpOAuthSecrets"])
			expect(savedSecrets[serverHash].tokens).to.deep.equal(mockTokens)
			expect(savedSecrets[serverHash].tokens_saved_at).to.be.a("number")
			expect(savedSecrets[serverHash].tokens_saved_at).to.be.closeTo(Date.now(), 1000)
		})
	})

	describe("Provider - clientInformation()", () => {
		it("should return undefined when no client info stored", async () => {
			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			const clientInfo = await provider.clientInformation()
			expect(clientInfo).to.be.undefined
		})

		it("should return stored client info", async () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")
			const mockClientInfo = {
				client_id: "test-client-id",
				client_secret: "test-client-secret",
			}

			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					client_info: mockClientInfo,
				},
			})

			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			const clientInfo = await provider.clientInformation()
			expect(clientInfo).to.deep.equal(mockClientInfo)
		})
	})

	describe("Provider - saveClientInformation()", () => {
		it("should save client information", async () => {
			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")

			const mockClientInfo = {
				client_id: "new-client-id",
				client_secret: "new-client-secret",
			}

			// saveClientInformation is optional in the interface but implemented in ClineOAuthClientProvider
			if (provider.saveClientInformation) {
				await provider.saveClientInformation(mockClientInfo as any)
			}

			const savedSecrets = JSON.parse(storedSecrets["mcpOAuthSecrets"])
			expect(savedSecrets[serverHash].client_info).to.deep.equal(mockClientInfo)
		})
	})

	describe("Provider - codeVerifier()", () => {
		it("should throw when no code verifier stored", async () => {
			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			try {
				await provider.codeVerifier()
				expect.fail("Should have thrown")
			} catch (error: any) {
				expect(error.message).to.include("No code verifier found")
			}
		})

		it("should return stored code verifier", async () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")
			const mockVerifier = "test-code-verifier-12345"

			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					code_verifier: mockVerifier,
				},
			})

			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			const verifier = await provider.codeVerifier()
			expect(verifier).to.equal(mockVerifier)
		})
	})

	describe("Provider - saveCodeVerifier()", () => {
		it("should save code verifier", async () => {
			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")

			await provider.saveCodeVerifier("new-code-verifier")

			const savedSecrets = JSON.parse(storedSecrets["mcpOAuthSecrets"])
			expect(savedSecrets[serverHash].code_verifier).to.equal("new-code-verifier")
		})
	})

	describe("Provider - redirectToAuthorization()", () => {
		it("should store auth URL with state parameter", async () => {
			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")

			const authUrl = new URL("https://auth.example.com/authorize?client_id=test")
			await provider.redirectToAuthorization(authUrl)

			const savedSecrets = JSON.parse(storedSecrets["mcpOAuthSecrets"])
			expect(savedSecrets[serverHash].pending_auth_url).to.exist
			expect(savedSecrets[serverHash].oauth_state).to.exist
			expect(savedSecrets[serverHash].oauth_state_timestamp).to.be.a("number")

			// Verify state is added to URL
			const savedUrl = new URL(savedSecrets[serverHash].pending_auth_url)
			expect(savedUrl.searchParams.get("state")).to.equal(savedSecrets[serverHash].oauth_state)
		})

		it("should not overwrite auth state if valid tokens exist", async () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")

			// Pre-store valid tokens
			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					tokens: {
						access_token: "valid-token",
						token_type: "Bearer",
					},
					tokens_saved_at: Date.now(),
					pending_auth_url: "https://old-url.com",
					oauth_state: "old-state",
				},
			})

			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			const authUrl = new URL("https://auth.example.com/authorize?client_id=test")
			await provider.redirectToAuthorization(authUrl)

			// Should preserve old state
			const savedSecrets = JSON.parse(storedSecrets["mcpOAuthSecrets"])
			expect(savedSecrets[serverHash].pending_auth_url).to.equal("https://old-url.com")
			expect(savedSecrets[serverHash].oauth_state).to.equal("old-state")
		})
	})

	describe("validateAndClearState", () => {
		it("should return false when no state stored", () => {
			const manager = new McpOAuthManager()
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")

			const result = manager.validateAndClearState(serverHash, "some-state")
			expect(result).to.be.false
		})

		it("should return true for valid state and clear it", () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")
			const validState = "valid-state-12345"

			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					oauth_state: validState,
					oauth_state_timestamp: Date.now(),
				},
			})

			const manager = new McpOAuthManager()
			const result = manager.validateAndClearState(serverHash, validState)

			expect(result).to.be.true

			// State should be cleared
			const savedSecrets = JSON.parse(storedSecrets["mcpOAuthSecrets"])
			expect(savedSecrets[serverHash].oauth_state).to.be.undefined
			expect(savedSecrets[serverHash].oauth_state_timestamp).to.be.undefined
		})

		it("should return false for invalid state", () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")

			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					oauth_state: "correct-state",
					oauth_state_timestamp: Date.now(),
				},
			})

			const manager = new McpOAuthManager()
			const result = manager.validateAndClearState(serverHash, "wrong-state")

			expect(result).to.be.false
		})

		it("should return false for expired state (> 10 minutes)", () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")
			const validState = "valid-state"

			// State created 15 minutes ago
			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					oauth_state: validState,
					oauth_state_timestamp: Date.now() - 15 * 60 * 1000,
				},
			})

			const manager = new McpOAuthManager()
			const result = manager.validateAndClearState(serverHash, validState)

			expect(result).to.be.false

			// Expired state should be cleared
			const savedSecrets = JSON.parse(storedSecrets["mcpOAuthSecrets"])
			expect(savedSecrets[serverHash].oauth_state).to.be.undefined
		})
	})

	describe("startOAuthFlow", () => {
		it("should open browser with stored auth URL", async () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")
			const authUrl = "https://auth.example.com/authorize?client_id=test&state=abc"

			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					pending_auth_url: authUrl,
				},
			})

			const manager = new McpOAuthManager()
			await manager.startOAuthFlow("test-server", "https://mcp.example.com")

			expect((envUtils.openExternal as sinon.SinonStub).calledOnceWith(authUrl)).to.be.true
		})

		it("should throw when no auth URL stored", async () => {
			const manager = new McpOAuthManager()

			try {
				await manager.startOAuthFlow("test-server", "https://mcp.example.com")
				expect.fail("Should have thrown")
			} catch (error: any) {
				expect(error.message).to.include("No auth URL found")
			}
		})
	})

	describe("clearServerAuth", () => {
		it("should clear all OAuth data for server", async () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")

			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					tokens: { access_token: "test" },
					client_info: { client_id: "test" },
					code_verifier: "test",
					oauth_state: "test",
					pending_auth_url: "https://test.com",
				},
			})

			const manager = new McpOAuthManager()
			// Create provider first so it's cached
			await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			await manager.clearServerAuth("test-server", "https://mcp.example.com")

			const savedSecrets = JSON.parse(storedSecrets["mcpOAuthSecrets"])
			expect(savedSecrets[serverHash]).to.be.undefined
		})

		it("should remove provider from cache", async () => {
			const manager = new McpOAuthManager()
			const provider1 = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			await manager.clearServerAuth("test-server", "https://mcp.example.com")

			// New provider should be created (not cached)
			const provider2 = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")
			expect(provider1).to.not.equal(provider2)
		})
	})

	describe("clearServerTokens", () => {
		it("should clear only tokens, preserving client_info", async () => {
			const serverHash = getServerAuthHash("test-server", "https://mcp.example.com")

			storedSecrets["mcpOAuthSecrets"] = JSON.stringify({
				[serverHash]: {
					tokens: { access_token: "test-token" },
					tokens_saved_at: 123456789,
					client_info: { client_id: "test-client" },
					code_verifier: "test-verifier",
				},
			})

			const manager = new McpOAuthManager()
			await manager.clearServerTokens("test-server", "https://mcp.example.com")

			const savedSecrets = JSON.parse(storedSecrets["mcpOAuthSecrets"])
			expect(savedSecrets[serverHash].tokens).to.be.undefined
			expect(savedSecrets[serverHash].tokens_saved_at).to.be.undefined
			// These should be preserved
			expect(savedSecrets[serverHash].client_info).to.deep.equal({ client_id: "test-client" })
			expect(savedSecrets[serverHash].code_verifier).to.equal("test-verifier")
		})

		it("should do nothing if server has no data", async () => {
			const manager = new McpOAuthManager()
			// Should not throw
			await manager.clearServerTokens("nonexistent-server", "https://mcp.example.com")
		})
	})

	describe("Provider - clientMetadata", () => {
		it("should return correct client metadata", async () => {
			const manager = new McpOAuthManager()
			const provider = await manager.getOrCreateProvider("test-server", "https://mcp.example.com")

			const metadata = provider.clientMetadata
			expect(metadata.client_name).to.equal("Cline")
			expect(metadata.grant_types).to.include("authorization_code")
			expect(metadata.grant_types).to.include("refresh_token")
			expect(metadata.response_types).to.include("code")
			expect(metadata.token_endpoint_auth_method).to.equal("none")
			expect(metadata.redirect_uris).to.have.lengthOf(1)
			expect(metadata.redirect_uris[0]).to.include("/mcp-auth/callback/")
		})
	})
})
