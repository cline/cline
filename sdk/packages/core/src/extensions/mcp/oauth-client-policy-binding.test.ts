import { describe, expect, it } from "vitest";
import { createMcpOAuthClientPolicyBinding } from "./oauth-client-policy-binding";

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
		expect(first).toMatch(/^sha256:[a-f\d]{64}$/);
		expect(first).not.toContain("static-client");
		expect(first).not.toContain("fixed-secret");
	});

	it("distinguishes dynamic registration and every static policy field", () => {
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
				clientSecret: "secret-b",
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
});
