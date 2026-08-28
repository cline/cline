import { createHash } from "node:crypto";
import { normalizeMcpOAuthAllowedScopes } from "./oauth-scope-policy";
import type { McpServerOAuthClientConfig } from "./types";

export const MCP_OAUTH_CLIENT_POLICY_BINDING_PATTERN = /^sha256:[a-f\d]{64}$/;

/**
 * Binds OAuth artifacts to either dynamic registration or one exact static
 * client policy. The digest covers the client secret without persisting it a
 * second time, and canonicalizes only fields whose configuration semantics are
 * order-insensitive.
 */
export function createMcpOAuthClientPolicyBinding(
	client: McpServerOAuthClientConfig | undefined,
): string {
	const canonicalPolicy = client
		? [
				"static",
				client.clientId,
				client.clientSecret ?? null,
				normalizeMcpOAuthAllowedScopes(client.allowedScopes) ?? null,
				client.loopbackHostname ?? "127.0.0.1",
			]
		: ["dynamic"];
	const canonicalIdentity = JSON.stringify([
		"cline-mcp-oauth-client-policy-v1",
		canonicalPolicy,
	]);
	return `sha256:${createHash("sha256").update(canonicalIdentity).digest("hex")}`;
}

export function isMcpOAuthClientPolicyBinding(value: unknown): value is string {
	return (
		typeof value === "string" &&
		MCP_OAUTH_CLIENT_POLICY_BINDING_PATTERN.test(value)
	);
}
