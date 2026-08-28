import { describe, expect, it } from "vitest";
import {
	buildMcpOAuthClientUpsert,
	buildMcpOAuthRedirectUris,
	createMcpOAuthClientFormFields,
	parseMcpOAuthAllowedScopesText,
} from "./mcp-oauth-form";

describe("MCP OAuth client form", () => {
	it("lists every local redirect URI in core bind order", () => {
		expect(buildMcpOAuthRedirectUris("127.0.0.1")).toEqual([
			"http://127.0.0.1:1456/mcp/oauth/callback",
			"http://127.0.0.1:1457/mcp/oauth/callback",
			"http://127.0.0.1:1458/mcp/oauth/callback",
		]);
		expect(buildMcpOAuthRedirectUris("localhost")).toEqual([
			"http://localhost:1456/mcp/oauth/callback",
			"http://localhost:1457/mcp/oauth/callback",
			"http://localhost:1458/mcp/oauth/callback",
		]);
	});

	it("surfaces and explicitly changes the loopback callback hostname", () => {
		const existing = createMcpOAuthClientFormFields({
			clientId: "desktop-client",
			hasClientSecret: false,
			loopbackHostname: "localhost",
		});
		expect(existing.loopbackHostname).toBe("localhost");
		expect(buildMcpOAuthClientUpsert(existing)).toEqual({
			clientId: "desktop-client",
			allowedScopes: null,
			loopbackHostname: "localhost",
		});
		expect(
			buildMcpOAuthClientUpsert({
				...existing,
				loopbackHostname: "127.0.0.1",
			}),
		).toEqual({
			clientId: "desktop-client",
			allowedScopes: null,
			loopbackHostname: null,
		});

		const fresh = createMcpOAuthClientFormFields();
		expect(
			buildMcpOAuthClientUpsert({
				...fresh,
				clientId: "desktop-client",
				loopbackHostname: "localhost",
			}),
		).toEqual({
			clientId: "desktop-client",
			allowedScopes: null,
			loopbackHostname: "localhost",
		});
	});

	it("retains localhost explicitly across OAuth identity changes", () => {
		const existing = createMcpOAuthClientFormFields(
			{
				clientId: "desktop-client",
				hasClientSecret: true,
				loopbackHostname: "localhost",
			},
			"https://mcp.slack.com/mcp",
			"streamableHttp",
			{ "X-Tenant": "one" },
		);
		for (const changed of [
			{ ...existing, clientId: "replacement-client" },
			{ ...existing, serverUrl: "https://example.com/mcp" },
			{ ...existing, transportType: "sse" },
			{ ...existing, headers: { "X-Tenant": "two" } },
		]) {
			expect(buildMcpOAuthClientUpsert(changed)).toMatchObject({
				clientId: changed.clientId.trim(),
				allowedScopes: null,
				loopbackHostname: "localhost",
			});
			expect(buildMcpOAuthClientUpsert(changed)).not.toHaveProperty(
				"preserveClientSecret",
			);
		}
	});

	it("preserves a saved secret without exposing it to the form", () => {
		const form = createMcpOAuthClientFormFields({
			clientId: "desktop-client",
			hasClientSecret: true,
		});

		expect(form.clientSecret).toBe("");
		expect(buildMcpOAuthClientUpsert(form)).toEqual({
			clientId: "desktop-client",
			preserveClientSecret: true,
			allowedScopes: null,
		});
	});

	it("replaces, clears, or removes the OAuth client explicitly", () => {
		const existing = createMcpOAuthClientFormFields({
			clientId: "desktop-client",
			hasClientSecret: true,
		});

		expect(
			buildMcpOAuthClientUpsert({
				...existing,
				clientSecret: "replacement-secret",
			}),
		).toEqual({
			clientId: "desktop-client",
			clientSecret: "replacement-secret",
			allowedScopes: null,
		});
		expect(
			buildMcpOAuthClientUpsert({
				...existing,
				preserveSavedClientSecret: false,
			}),
		).toEqual({ clientId: "desktop-client", allowedScopes: null });
		expect(
			buildMcpOAuthClientUpsert({
				...existing,
				clientId: "",
			}),
		).toBeNull();
	});

	it("does not carry a saved secret to a different client ID", () => {
		const existing = createMcpOAuthClientFormFields({
			clientId: "desktop-client",
			hasClientSecret: true,
		});

		expect(
			buildMcpOAuthClientUpsert({
				...existing,
				clientId: "replacement-client",
			}),
		).toEqual({ clientId: "replacement-client", allowedScopes: null });
	});

	it("does not carry a saved secret to a different server endpoint", () => {
		const existing = createMcpOAuthClientFormFields(
			{
				clientId: "desktop-client",
				hasClientSecret: true,
			},
			"https://mcp.slack.com/mcp",
		);

		expect(
			buildMcpOAuthClientUpsert({
				...existing,
				serverUrl: "https://example.com/mcp",
			}),
		).toEqual({ clientId: "desktop-client", allowedScopes: null });
	});

	it("does not carry a saved secret to a different remote transport", () => {
		const existing = createMcpOAuthClientFormFields(
			{
				clientId: "desktop-client",
				hasClientSecret: true,
			},
			"https://mcp.slack.com/mcp",
			"streamableHttp",
		);

		expect(
			buildMcpOAuthClientUpsert({
				...existing,
				transportType: "sse",
			}),
		).toEqual({ clientId: "desktop-client", allowedScopes: null });
	});

	it("binds saved-secret preservation to canonical remote headers", () => {
		const existing = createMcpOAuthClientFormFields(
			{
				clientId: "desktop-client",
				hasClientSecret: true,
			},
			"https://mcp.example.com/mcp",
			"streamableHttp",
			{ Authorization: "Bearer fixed", "X-Tenant": "one" },
		);

		expect(
			buildMcpOAuthClientUpsert({
				...existing,
				headers: { "X-Tenant": "one", Authorization: "Bearer fixed" },
			}),
		).toEqual({
			clientId: "desktop-client",
			preserveClientSecret: true,
			allowedScopes: null,
		});
		expect(
			buildMcpOAuthClientUpsert({
				...existing,
				headers: { Authorization: "Bearer fixed", "X-Tenant": "two" },
			}),
		).toEqual({ clientId: "desktop-client", allowedScopes: null });
	});

	it("requires a client ID before accepting a client secret", () => {
		expect(() =>
			buildMcpOAuthClientUpsert({
				...createMcpOAuthClientFormFields(),
				clientSecret: "orphaned-secret",
			}),
		).toThrow("OAuth client ID is required");
	});

	it("surfaces and canonicalizes an allowed-scope maximum", () => {
		const form = createMcpOAuthClientFormFields({
			clientId: "desktop-client",
			hasClientSecret: false,
			allowedScopes: ["search:read.public", "channels:history"],
		});

		expect(form.allowedScopesText).toBe("search:read.public\nchannels:history");
		expect(buildMcpOAuthClientUpsert(form)).toEqual({
			clientId: "desktop-client",
			allowedScopes: ["channels:history", "search:read.public"],
		});
	});

	it("fails closed on duplicate, whitespace, and invalid scope input", () => {
		expect(() =>
			parseMcpOAuthAllowedScopesText("channels:history\nchannels:history"),
		).toThrow("Duplicate OAuth scope");
		expect(() =>
			parseMcpOAuthAllowedScopesText("channels:history chat:write"),
		).toThrow("without whitespace");
		expect(() => parseMcpOAuthAllowedScopesText(" channels:history")).toThrow(
			"without surrounding whitespace",
		);
		expect(() => parseMcpOAuthAllowedScopesText('channels:"history')).toThrow(
			"valid RFC 6749 scope tokens",
		);
		expect(() => parseMcpOAuthAllowedScopesText("channels:history\n")).toThrow(
			"exactly one token per line",
		);
	});
});
