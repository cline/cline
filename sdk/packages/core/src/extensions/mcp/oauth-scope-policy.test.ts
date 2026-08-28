import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { describe, expect, it, vi } from "vitest";
import { createMcpSdkTransport } from "./oauth";
import {
	createMcpOAuthScopePolicyFetch,
	McpOAuthScopePolicyError,
	normalizeMcpOAuthAllowedScopes,
} from "./oauth-scope-policy";

describe("MCP OAuth scope policy", () => {
	it("canonicalizes valid policies and rejects malformed or duplicate scopes", () => {
		expect(
			normalizeMcpOAuthAllowedScopes([
				"search:read.public",
				"channels:history",
			]),
		).toEqual(["channels:history", "search:read.public"]);
		expect(() => normalizeMcpOAuthAllowedScopes([])).toThrow(
			McpOAuthScopePolicyError,
		);
		expect(() =>
			normalizeMcpOAuthAllowedScopes(["channels:history", "channels:history"]),
		).toThrow(/Duplicate/);
		expect(() =>
			normalizeMcpOAuthAllowedScopes(["channels:history chat:write"]),
		).toThrow(/Invalid/);
	});

	it("injects the configured maximum when a Bearer challenge omits scope", async () => {
		const baseFetch = vi.fn(
			async () =>
				new Response("authorization required", {
					status: 401,
					headers: {
						"WWW-Authenticate":
							'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"',
					},
				}),
		);
		const policyFetch = createMcpOAuthScopePolicyFetch(baseFetch, [
			"search:read.public",
			"channels:history",
		]);
		if (!policyFetch) {
			throw new Error("Expected a policy fetch wrapper.");
		}

		const response = await policyFetch("https://mcp.example.test/mcp");
		expect(response.headers.get("WWW-Authenticate")).toBe(
			'Bearer scope="channels:history search:read.public", resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"',
		);
		await expect(response.text()).resolves.toBe("authorization required");
	});

	it("rejects authorization and upscope challenges outside the policy", async () => {
		const authorizeFetch = createMcpOAuthScopePolicyFetch(
			async () =>
				new Response(null, {
					status: 401,
					headers: {
						"WWW-Authenticate": 'Bearer scope="channels:history chat:write"',
					},
				}),
			["channels:history"],
		);
		const upscopeFetch = createMcpOAuthScopePolicyFetch(
			async () =>
				new Response(null, {
					status: 403,
					headers: {
						"WWW-Authenticate":
							'Bearer error="insufficient_scope", scope="chat:write"',
					},
				}),
			["channels:history"],
		);

		await expect(
			authorizeFetch?.("https://mcp.example.test/mcp"),
		).rejects.toThrow(/chat:write/);
		await expect(
			upscopeFetch?.("https://mcp.example.test/mcp"),
		).rejects.toThrow(/chat:write/);
	});

	it("preserves the existing fetch path when no policy is configured", () => {
		const baseFetch = vi.fn<typeof fetch>();
		expect(createMcpOAuthScopePolicyFetch(baseFetch, undefined)).toBe(
			baseFetch,
		);
	});

	it("overrides broad protected-resource metadata in the SDK authorization URL", async () => {
		let authorizationUrl: URL | undefined;
		let codeVerifier: string | undefined;
		const provider: OAuthClientProvider = {
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
			clientMetadata: {
				client_name: "Cline",
				redirect_uris: ["http://127.0.0.1:1456/mcp/oauth/callback"],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
				scope: "channels:history",
			},
			clientInformation: () => ({ client_id: "cline-internal-client" }),
			tokens: () => undefined,
			saveTokens: () => undefined,
			redirectToAuthorization: (url) => {
				authorizationUrl = url;
			},
			saveCodeVerifier: (value) => {
				codeVerifier = value;
			},
			codeVerifier: () => {
				if (!codeVerifier) {
					throw new Error("Missing test code verifier.");
				}
				return codeVerifier;
			},
		};
		const fetch = vi.fn(async (input: string | URL) => {
			const url = new URL(input);
			if (url.href === "https://mcp.example.test/mcp") {
				return new Response(null, {
					status: 401,
					headers: {
						"WWW-Authenticate":
							'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"',
					},
				});
			}
			if (
				url.href ===
				"https://mcp.example.test/.well-known/oauth-protected-resource"
			) {
				return Response.json({
					resource: "https://mcp.example.test/mcp",
					authorization_servers: ["https://auth.example.test"],
					scopes_supported: ["channels:history", "chat:write"],
				});
			}
			if (
				url.href ===
				"https://auth.example.test/.well-known/oauth-authorization-server"
			) {
				return Response.json({
					issuer: "https://auth.example.test",
					authorization_endpoint: "https://auth.example.test/authorize",
					token_endpoint: "https://auth.example.test/token",
					response_types_supported: ["code"],
					grant_types_supported: ["authorization_code", "refresh_token"],
					code_challenge_methods_supported: ["S256"],
					token_endpoint_auth_methods_supported: ["none"],
				});
			}
			return new Response(null, { status: 404 });
		});
		const transport = createMcpSdkTransport({
			registration: {
				name: "slack",
				transport: {
					type: "streamableHttp",
					url: "https://mcp.example.test/mcp",
				},
				oauthClient: {
					clientId: "cline-internal-client",
					allowedScopes: ["channels:history"],
				},
			},
			oauthProvider: provider,
			fetch,
		});

		try {
			await expect(
				transport.send({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "test", version: "0.0.0" },
					},
				}),
			).rejects.toBeInstanceOf(UnauthorizedError);
			expect(authorizationUrl?.searchParams.get("scope")).toBe(
				"channels:history",
			);
		} finally {
			await transport.close();
		}
	});
});
