import { areMcpOAuthScopePoliciesEqual } from "./oauth-scope-policy";
import type { McpServerOAuthClientConfig } from "./types";

/**
 * Exact in-memory/configuration equality for provider-cache and locked-write
 * guards. Scope order is non-semantic, and an omitted loopback hostname is the
 * explicit `127.0.0.1` default. The confidential secret is compared directly
 * because the persisted public-policy binding deliberately excludes it.
 */
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
