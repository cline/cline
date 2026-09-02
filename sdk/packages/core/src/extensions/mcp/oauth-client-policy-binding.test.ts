import { describe, expect, it } from "vitest";
import { areMcpOAuthClientConfigurationsEqual } from "./oauth-client-policy";
import {
	createMcpOAuthClientPolicyBinding,
	MCP_OAUTH_CLIENT_POLICY_BINDING_PREFIX,
} from "./oauth-client-policy-binding";

describe("MCP OAuth client policy binding", () => {
	it("canonicalizes scope order without exposing a client secret", () => {
		const first = createMcpOAuthClientPolicyBinding({
			clientId: "static-client",
			clientSecret: "fixed-secret",
			allowedScopes: ["search:write", "search:read"],
		});
		const reordered = createMcpOAuthClientPolicyBinding({
			clientId: "static-client",
			clientSecret: "fixed-secret",
			allowedScopes: ["search:read", "search:write"],
			loopbackHostname: "127.0.0.1",
		});

		expect(first).toBe(reordered);
		expect(first).toMatch(/^mcp-oauth-client-policy-v2-public:[A-Za-z\d_-]+$/);
		const publicPolicy = Buffer.from(
			first.slice(MCP_OAUTH_CLIENT_POLICY_BINDING_PREFIX.length),
			"base64url",
		).toString("utf8");
		expect(publicPolicy).toContain("static-client");
		expect(publicPolicy).not.toContain("fixed-secret");
	});

	it("distinguishes dynamic registration and every public static policy field", () => {
		const baseline = createMcpOAuthClientPolicyBinding({
			clientId: "client-a",
			clientSecret: "secret-a",
			allowedScopes: ["read"],
		});
		const variants = [
			undefined,
			{
				clientId: "client-b",
				clientSecret: "secret-a",
				allowedScopes: ["read"],
			},
			{
				clientId: "client-a",
				clientSecret: "secret-a",
				allowedScopes: ["write"],
			},
			{
				clientId: "client-a",
				clientSecret: "secret-a",
				allowedScopes: ["read"],
				loopbackHostname: "localhost" as const,
			},
		];

		for (const variant of variants) {
			expect(createMcpOAuthClientPolicyBinding(variant)).not.toBe(baseline);
		}
	});

	it("excludes secrets from persisted identity while comparing them exactly", () => {
		const first = {
			clientId: "client-a",
			clientSecret: "secret-a",
			allowedScopes: ["read"],
		};
		const changedSecret = { ...first, clientSecret: "secret-b" };

		expect(createMcpOAuthClientPolicyBinding(changedSecret)).toBe(
			createMcpOAuthClientPolicyBinding(first),
		);
		expect(areMcpOAuthClientConfigurationsEqual(first, changedSecret)).toBe(
			false,
		);
		expect(
			areMcpOAuthClientConfigurationsEqual(first, {
				...first,
				allowedScopes: ["read"],
				loopbackHostname: "127.0.0.1",
			}),
		).toBe(true);
	});
});
