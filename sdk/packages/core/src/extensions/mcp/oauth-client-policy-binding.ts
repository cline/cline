import { createHash } from "node:crypto";
import { normalizeMcpOAuthAllowedScopes } from "./oauth-scope-policy";
import type { McpServerOAuthClientConfig } from "./types";

export const MCP_OAUTH_CLIENT_POLICY_BINDING_PATTERN = /^sha256:[a-f\d]{64}$/;

/**
 * Binds OAuth artifacts to either dynamic registration or one exact static
 * public-client policy. Client secrets are deliberately excluded: this digest
 * is persisted identity metadata, not a password verifier, and must not create
 * an offline guessing oracle. Callers compare the configured secret exactly
 * before reusing credentials or an in-memory provider.
 */
export function createMcpOAuthClientPolicyBinding(
	client: McpServerOAuthClientConfig | undefined,
): string {
	const canonicalPolicy = client
		? [
				"static",
				client.clientId,
				normalizeMcpOAuthAllowedScopes(client.allowedScopes) ?? null,
				client.loopbackHostname ?? "127.0.0.1",
			]
		: ["dynamic"];
	const canonicalIdentity = JSON.stringify([
		"cline-mcp-oauth-client-policy-v2-public",
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
