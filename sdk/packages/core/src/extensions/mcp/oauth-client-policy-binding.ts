import { normalizeMcpOAuthAllowedScopes } from "./oauth-scope-policy";
import type { McpServerOAuthClientConfig } from "./types";

export const MCP_OAUTH_CLIENT_POLICY_BINDING_PREFIX =
	"mcp-oauth-client-policy-v2-public:";
export const MCP_OAUTH_CLIENT_POLICY_BINDING_PATTERN =
	/^mcp-oauth-client-policy-v2-public:[A-Za-z\d_-]+$/;

/**
 * Binds OAuth artifacts to either dynamic registration or one exact static
 * public-client policy. Client secrets are deliberately excluded. The binding
 * is a tagged, reversible encoding so neither humans nor static analysis can
 * mistake it for a password verifier; all encoded fields are public metadata.
 * Callers compare the configured secret exactly before reusing credentials or
 * an in-memory provider.
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
	const encodedPolicy = Buffer.from(
		JSON.stringify(canonicalPolicy),
		"utf8",
	).toString("base64url");
	return `${MCP_OAUTH_CLIENT_POLICY_BINDING_PREFIX}${encodedPolicy}`;
}

export function isMcpOAuthClientPolicyBinding(value: unknown): value is string {
	return (
		typeof value === "string" &&
		MCP_OAUTH_CLIENT_POLICY_BINDING_PATTERN.test(value)
	);
}
