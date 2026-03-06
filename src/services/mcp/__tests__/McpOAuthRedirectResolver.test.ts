import { describe, it } from "mocha"
import "should"
import { type GetCallbackUrlFn, McpOAuthRedirectResolver } from "../McpOAuthRedirectResolver"

describe("McpOAuthRedirectResolver", () => {
	describe("extractLoopbackPort", () => {
		it("should extract port from http://127.0.0.1:48801/path", () => {
			const port = McpOAuthRedirectResolver.extractLoopbackPort("http://127.0.0.1:48801/mcp-auth/callback/abc123")
			port!.should.equal(48801)
		})

		it("should extract port from http://127.0.0.1:48811 (no path)", () => {
			const port = McpOAuthRedirectResolver.extractLoopbackPort("http://127.0.0.1:48811")
			port!.should.equal(48811)
		})

		it("should return undefined for vscode:// URLs", () => {
			const port = McpOAuthRedirectResolver.extractLoopbackPort("vscode://saoudrizwan.claude-dev/mcp-auth/callback/abc123")
			should(port).be.undefined()
		})

		it("should return undefined for https:// URLs", () => {
			const port = McpOAuthRedirectResolver.extractLoopbackPort("https://codespace-abc.github.dev/mcp-auth/callback/abc123")
			should(port).be.undefined()
		})

		it("should return undefined for malformed URLs", () => {
			const port = McpOAuthRedirectResolver.extractLoopbackPort("not-a-url")
			should(port).be.undefined()
		})

		it("should return undefined for empty string", () => {
			const port = McpOAuthRedirectResolver.extractLoopbackPort("")
			should(port).be.undefined()
		})

		it("should return undefined for http://localhost (not 127.0.0.1)", () => {
			const port = McpOAuthRedirectResolver.extractLoopbackPort("http://localhost:3000/callback")
			should(port).be.undefined()
		})

		it("should return undefined for http://127.0.0.1 without a port", () => {
			// http://127.0.0.1/path has no explicit port (defaults to 80)
			// URL.port returns "" for default ports
			const port = McpOAuthRedirectResolver.extractLoopbackPort("http://127.0.0.1/path")
			should(port).be.undefined()
		})
	})

	describe("isLoopbackUrl", () => {
		it("should return true for http://127.0.0.1:48801/...", () => {
			McpOAuthRedirectResolver.isLoopbackUrl("http://127.0.0.1:48801/mcp-auth/callback/abc").should.be.true()
		})

		it("should return true for http://127.0.0.1 without port", () => {
			McpOAuthRedirectResolver.isLoopbackUrl("http://127.0.0.1/path").should.be.true()
		})

		it("should return false for vscode:// URLs", () => {
			McpOAuthRedirectResolver.isLoopbackUrl("vscode://saoudrizwan.claude-dev/path").should.be.false()
		})

		it("should return false for https:// URLs", () => {
			McpOAuthRedirectResolver.isLoopbackUrl("https://example.com/path").should.be.false()
		})

		it("should return false for http://localhost (not 127.0.0.1)", () => {
			McpOAuthRedirectResolver.isLoopbackUrl("http://localhost:3000/path").should.be.false()
		})

		it("should return false for malformed URLs", () => {
			McpOAuthRedirectResolver.isLoopbackUrl("not-a-url").should.be.false()
		})
	})

	describe("isRedirectCompatible", () => {
		it("should return true when URLs are identical", () => {
			McpOAuthRedirectResolver.isRedirectCompatible(
				"http://127.0.0.1:48801/mcp-auth/callback/abc123",
				"http://127.0.0.1:48801/mcp-auth/callback/abc123",
			).should.be.true()
		})

		it("should return true for identical vscode:// URLs", () => {
			McpOAuthRedirectResolver.isRedirectCompatible(
				"vscode://saoudrizwan.claude-dev/mcp-auth/callback/abc123",
				"vscode://saoudrizwan.claude-dev/mcp-auth/callback/abc123",
			).should.be.true()
		})

		it("should return true for identical https:// URLs", () => {
			McpOAuthRedirectResolver.isRedirectCompatible(
				"https://codespace-abc.github.dev/mcp-auth/callback/abc123",
				"https://codespace-abc.github.dev/mcp-auth/callback/abc123",
			).should.be.true()
		})

		it("should return false when saved URL is undefined (legacy state)", () => {
			McpOAuthRedirectResolver.isRedirectCompatible(
				undefined,
				"http://127.0.0.1:48801/mcp-auth/callback/abc123",
			).should.be.false()
		})

		it("should return false when ports differ", () => {
			McpOAuthRedirectResolver.isRedirectCompatible(
				"http://127.0.0.1:48801/mcp-auth/callback/abc123",
				"http://127.0.0.1:48802/mcp-auth/callback/abc123",
			).should.be.false()
		})

		it("should return false when schemes differ (VSCode → JetBrains migration)", () => {
			McpOAuthRedirectResolver.isRedirectCompatible(
				"vscode://saoudrizwan.claude-dev/mcp-auth/callback/abc123",
				"http://127.0.0.1:48801/mcp-auth/callback/abc123",
			).should.be.false()
		})

		it("should return false when schemes differ (JetBrains → VSCode migration)", () => {
			McpOAuthRedirectResolver.isRedirectCompatible(
				"http://127.0.0.1:48801/mcp-auth/callback/abc123",
				"vscode://saoudrizwan.claude-dev/mcp-auth/callback/abc123",
			).should.be.false()
		})

		it("should return false when paths differ (different server hash)", () => {
			McpOAuthRedirectResolver.isRedirectCompatible(
				"http://127.0.0.1:48801/mcp-auth/callback/hash1",
				"http://127.0.0.1:48801/mcp-auth/callback/hash2",
			).should.be.false()
		})

		it("should return false when codespace domains differ", () => {
			McpOAuthRedirectResolver.isRedirectCompatible(
				"https://codespace-old.github.dev/mcp-auth/callback/abc123",
				"https://codespace-new.github.dev/mcp-auth/callback/abc123",
			).should.be.false()
		})
	})

	describe("resolve", () => {
		it("should get fresh URL and mark registration invalid when no saved URL", async () => {
			const getCallbackUrl: GetCallbackUrlFn = async (path, _preferredPort) => {
				return `http://127.0.0.1:48801${path}`
			}

			const result = await McpOAuthRedirectResolver.resolve(undefined, "/mcp-auth/callback/abc123", getCallbackUrl)

			result.redirectUrl.should.equal("http://127.0.0.1:48801/mcp-auth/callback/abc123")
			result.isRegistrationValid.should.be.false()
		})

		it("should reuse port when saved loopback URL port is available", async () => {
			const savedUrl = "http://127.0.0.1:48803/mcp-auth/callback/abc123"

			// Mock: the provider successfully binds the preferred port
			const getCallbackUrl: GetCallbackUrlFn = async (path, preferredPort) => {
				// Simulate: preferred port was available, so we got the same port back
				const port = preferredPort || 48801
				return `http://127.0.0.1:${port}${path}`
			}

			const result = await McpOAuthRedirectResolver.resolve(savedUrl, "/mcp-auth/callback/abc123", getCallbackUrl)

			result.redirectUrl.should.equal("http://127.0.0.1:48803/mcp-auth/callback/abc123")
			result.isRegistrationValid.should.be.true()
		})

		it("should fall back to new port and mark registration invalid when preferred port is unavailable", async () => {
			const savedUrl = "http://127.0.0.1:48803/mcp-auth/callback/abc123"

			// Mock: the provider cannot bind the preferred port, falls back to another
			const getCallbackUrl: GetCallbackUrlFn = async (path, _preferredPort) => {
				// Simulate: preferred port was occupied, fell back to 48805
				return `http://127.0.0.1:48805${path}`
			}

			const result = await McpOAuthRedirectResolver.resolve(savedUrl, "/mcp-auth/callback/abc123", getCallbackUrl)

			result.redirectUrl.should.equal("http://127.0.0.1:48805/mcp-auth/callback/abc123")
			result.isRegistrationValid.should.be.false()
		})

		it("should pass preferred port to getCallbackUrl for loopback URLs", async () => {
			const savedUrl = "http://127.0.0.1:48807/mcp-auth/callback/abc123"
			let receivedPreferredPort: number | undefined

			const getCallbackUrl: GetCallbackUrlFn = async (path, preferredPort) => {
				receivedPreferredPort = preferredPort
				const port = preferredPort || 48801
				return `http://127.0.0.1:${port}${path}`
			}

			await McpOAuthRedirectResolver.resolve(savedUrl, "/mcp-auth/callback/abc123", getCallbackUrl)

			receivedPreferredPort!.should.equal(48807)
		})

		it("should NOT pass preferred port for non-loopback saved URLs (vscode://)", async () => {
			const savedUrl = "vscode://saoudrizwan.claude-dev/mcp-auth/callback/abc123"
			let receivedPreferredPort: number | undefined

			const getCallbackUrl: GetCallbackUrlFn = async (path, preferredPort) => {
				receivedPreferredPort = preferredPort
				return `vscode://saoudrizwan.claude-dev${path}`
			}

			await McpOAuthRedirectResolver.resolve(savedUrl, "/mcp-auth/callback/abc123", getCallbackUrl)

			should(receivedPreferredPort).be.undefined()
		})

		it("should mark registration valid when VSCode URLs match", async () => {
			const savedUrl = "vscode://saoudrizwan.claude-dev/mcp-auth/callback/abc123"

			const getCallbackUrl: GetCallbackUrlFn = async (path, _preferredPort) => {
				return `vscode://saoudrizwan.claude-dev${path}`
			}

			const result = await McpOAuthRedirectResolver.resolve(savedUrl, "/mcp-auth/callback/abc123", getCallbackUrl)

			result.redirectUrl.should.equal("vscode://saoudrizwan.claude-dev/mcp-auth/callback/abc123")
			result.isRegistrationValid.should.be.true()
		})

		it("should mark registration invalid for VSCode → JetBrains cross-platform migration", async () => {
			const savedUrl = "vscode://saoudrizwan.claude-dev/mcp-auth/callback/abc123"

			// Now running on JetBrains, which uses loopback
			const getCallbackUrl: GetCallbackUrlFn = async (path, _preferredPort) => {
				return `http://127.0.0.1:48801${path}`
			}

			const result = await McpOAuthRedirectResolver.resolve(savedUrl, "/mcp-auth/callback/abc123", getCallbackUrl)

			result.redirectUrl.should.equal("http://127.0.0.1:48801/mcp-auth/callback/abc123")
			result.isRegistrationValid.should.be.false()
		})

		it("should mark registration invalid for JetBrains → VSCode cross-platform migration", async () => {
			const savedUrl = "http://127.0.0.1:48801/mcp-auth/callback/abc123"

			// Now running on VSCode
			const getCallbackUrl: GetCallbackUrlFn = async (path, _preferredPort) => {
				return `vscode://saoudrizwan.claude-dev${path}`
			}

			const result = await McpOAuthRedirectResolver.resolve(savedUrl, "/mcp-auth/callback/abc123", getCallbackUrl)

			result.redirectUrl.should.equal("vscode://saoudrizwan.claude-dev/mcp-auth/callback/abc123")
			result.isRegistrationValid.should.be.false()
		})

		it("should handle VSCode Web URLs (https://)", async () => {
			const savedUrl = "https://codespace-abc.github.dev/mcp-auth/callback/abc123"

			const getCallbackUrl: GetCallbackUrlFn = async (path, _preferredPort) => {
				return `https://codespace-abc.github.dev${path}`
			}

			const result = await McpOAuthRedirectResolver.resolve(savedUrl, "/mcp-auth/callback/abc123", getCallbackUrl)

			result.redirectUrl.should.equal("https://codespace-abc.github.dev/mcp-auth/callback/abc123")
			result.isRegistrationValid.should.be.true()
		})

		it("should detect codespace change as registration invalid", async () => {
			const savedUrl = "https://codespace-old.github.dev/mcp-auth/callback/abc123"

			const getCallbackUrl: GetCallbackUrlFn = async (path, _preferredPort) => {
				return `https://codespace-new.github.dev${path}`
			}

			const result = await McpOAuthRedirectResolver.resolve(savedUrl, "/mcp-auth/callback/abc123", getCallbackUrl)

			result.redirectUrl.should.equal("https://codespace-new.github.dev/mcp-auth/callback/abc123")
			result.isRegistrationValid.should.be.false()
		})
	})
})
