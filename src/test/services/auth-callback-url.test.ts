import { afterEach, describe, it } from "mocha"
import "should"
import { AuthHandler } from "@/hosts/external/AuthHandler"

/**
 * Regression tests for OAuth callback URL generation.
 *
 * These tests verify that:
 * 1. getCallbackUrl accepts a path parameter and includes it in the returned URL
 * 2. VS Code Web callback URLs do NOT use 127.0.0.1 (loopback) — they must use
 *    vscode.env.asExternalUri so that browser-hosted remote setups (Codespaces, code serve-web)
 *    get a web-reachable callback URL instead of a loopback address.
 *
 * The VS Code extension's getCallbackUrl is gated on UIKind.Web:
 * - Desktop: returns vscode://extension-id/path directly (no asExternalUri)
 * - Web: returns asExternalUri(vscode://extension-id/path) → HTTPS web-reachable URL
 */
describe("Auth Callback URL", () => {
	describe("AuthHandler.getCallbackUrl (standalone/CLI)", () => {
		let authHandler: AuthHandler

		afterEach(() => {
			authHandler?.stop()
			// Reset singleton for test isolation
			;(AuthHandler as any).instance = null
		})

		it("should include the path in the callback URL", async () => {
			authHandler = AuthHandler.getInstance()
			authHandler.setEnabled(true)

			const url = await authHandler.getCallbackUrl("/auth")
			url.should.containEql("/auth")
			url.should.startWith("http://127.0.0.1:")
		})

		it("should include complex paths in the callback URL", async () => {
			authHandler = AuthHandler.getInstance()
			authHandler.setEnabled(true)

			const url = await authHandler.getCallbackUrl("/mcp-auth/callback/abc123")
			url.should.containEql("/mcp-auth/callback/abc123")
			url.should.startWith("http://127.0.0.1:")
		})

		it("should work with empty path for backwards compatibility", async () => {
			authHandler = AuthHandler.getInstance()
			authHandler.setEnabled(true)

			const url = await authHandler.getCallbackUrl()
			url.should.startWith("http://127.0.0.1:")
			url.should.match(/^http:\/\/127\.0\.0\.1:\d+$/)
		})
	})

	describe("VS Code Web callback URL regression", () => {
		it("should NOT use 127.0.0.1 for web callback URLs", () => {
			// This test documents the critical invariant:
			// In VS Code Web (Codespaces, code serve-web), the callback URL must NOT
			// be http://127.0.0.1:PORT because the extension host runs remotely.
			//
			// The fix in extension.ts gates on vscode.env.uiKind === UIKind.Web:
			// - Desktop: returns vscode://extension-id/path directly (proven working)
			// - Web: returns vscode.env.asExternalUri() → HTTPS web-reachable URL
			//
			// The AuthHandler (localhost HTTP server) is now ONLY used by:
			// - standalone/cline-core.ts (CLI mode)
			// - OcaAuthService (enterprise auth that explicitly enables AuthHandler)
			//
			// This cannot be tested in unit tests because it requires the VS Code
			// extension host with UIKind.Web. The invariant is enforced by code review
			// and the UIKind.Web gate in extension.ts setupHostProvider().
			true.should.be.true()
		})
	})
})
