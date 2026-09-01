import { areMcpOAuthScopePoliciesEqual } from "./oauth-scope-policy";
import type { McpServerOAuthClientConfig } from "./types";

/** Exact in-memory/configuration equality, including a confidential secret. */
export function areMcpOAuthClientConfigurationsEqual(
	left: McpServerOAuthClientConfig | undefined,
	right: McpServerOAuthClientConfig | undefined,
): boolean {
	return (
		left?.clientId === right?.clientId &&
		left?.clientSecret === right?.clientSecret &&
		areMcpOAuthScopePoliciesEqual(left?.allowedScopes, right?.allowedScopes) &&
		(left?.loopbackHostname ?? "127.0.0.1") ===
			(right?.loopbackHostname ?? "127.0.0.1")
	);
}
