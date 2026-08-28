export interface McpOAuthClientSummary {
	clientId: string;
	hasClientSecret: boolean;
	allowedScopes?: string[];
	loopbackHostname?: McpOAuthLoopbackHostname;
}

export type McpOAuthLoopbackHostname = "127.0.0.1" | "localhost";

export interface McpOAuthClientUpsert {
	clientId: string;
	clientSecret?: string;
	preserveClientSecret?: boolean;
	allowedScopes: string[] | null;
	loopbackHostname?: McpOAuthLoopbackHostname | null;
}

export interface McpOAuthClientFormFields {
	clientId: string;
	clientSecret: string;
	originalClientId: string;
	hasSavedClientSecret: boolean;
	preserveSavedClientSecret: boolean;
	allowedScopesText: string;
	loopbackHostname: McpOAuthLoopbackHostname;
	originalLoopbackHostname: McpOAuthLoopbackHostname;
	serverUrl: string;
	originalServerUrl: string;
	transportType: string;
	originalTransportType: string;
	headers?: Record<string, string>;
	originalHeaders?: Record<string, string>;
}

// RFC 6749 section 3.3 scope-token: printable ASCII excluding DQUOTE and "\\".
const MCP_OAUTH_SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

export function buildMcpOAuthRedirectUris(
	hostname: McpOAuthLoopbackHostname,
): string[] {
	return [1456, 1457, 1458].map(
		(port) => `http://${hostname}:${port}/mcp/oauth/callback`,
	);
}

export function createMcpOAuthClientFormFields(
	existing?: McpOAuthClientSummary,
	serverUrl = "",
	transportType = "streamableHttp",
	headers?: Record<string, string>,
): McpOAuthClientFormFields {
	return {
		clientId: existing?.clientId ?? "",
		clientSecret: "",
		originalClientId: existing?.clientId ?? "",
		hasSavedClientSecret: existing?.hasClientSecret ?? false,
		preserveSavedClientSecret: existing?.hasClientSecret ?? false,
		allowedScopesText: existing?.allowedScopes?.join("\n") ?? "",
		loopbackHostname: existing?.loopbackHostname ?? "127.0.0.1",
		originalLoopbackHostname: existing?.loopbackHostname ?? "127.0.0.1",
		serverUrl,
		originalServerUrl: serverUrl,
		transportType,
		originalTransportType: transportType,
		headers: headers ? { ...headers } : undefined,
		originalHeaders: headers ? { ...headers } : undefined,
	};
}

function mcpRemoteHeadersIdentity(
	headers: Record<string, string> | undefined,
): string {
	if (headers === undefined) {
		return "omitted";
	}
	const entries = Object.entries(headers).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	return `present:${JSON.stringify(entries)}`;
}

export function isMcpOAuthClientIdentityUnchanged(
	form: McpOAuthClientFormFields,
): boolean {
	return (
		form.clientId.trim() === form.originalClientId &&
		form.serverUrl.trim() === form.originalServerUrl &&
		form.transportType === form.originalTransportType &&
		mcpRemoteHeadersIdentity(form.headers) ===
			mcpRemoteHeadersIdentity(form.originalHeaders)
	);
}

export function parseMcpOAuthAllowedScopesText(
	text: string,
): string[] | undefined {
	if (text.length === 0) {
		return undefined;
	}
	const scopes = text.split(/\r?\n/);
	const seen = new Set<string>();
	for (const scope of scopes) {
		if (!scope || scope !== scope.trim()) {
			throw new Error(
				"OAuth scopes must contain exactly one token per line without surrounding whitespace.",
			);
		}
		if (!MCP_OAUTH_SCOPE_TOKEN_PATTERN.test(scope)) {
			throw new Error(
				"OAuth scopes must be valid RFC 6749 scope tokens without whitespace, quotes, or backslashes.",
			);
		}
		if (seen.has(scope)) {
			throw new Error(`Duplicate OAuth scope: ${scope}`);
		}
		seen.add(scope);
	}
	return scopes.sort();
}

export function buildMcpOAuthClientUpsert(
	form: McpOAuthClientFormFields,
): McpOAuthClientUpsert | null {
	const clientId = form.clientId.trim();
	if (!clientId) {
		if (
			!form.originalClientId &&
			(form.clientSecret.length > 0 || form.allowedScopesText.length > 0)
		) {
			throw new Error(
				"OAuth client ID is required when a secret or scope policy is provided.",
			);
		}
		return null;
	}
	const allowedScopes = parseMcpOAuthAllowedScopesText(form.allowedScopesText);
	const loopbackHostnameUpdate =
		form.loopbackHostname === "localhost"
			? "localhost"
			: form.originalLoopbackHostname === "localhost"
				? null
				: undefined;
	if (form.clientSecret.length > 0) {
		return {
			clientId,
			clientSecret: form.clientSecret,
			allowedScopes: allowedScopes ?? null,
			...(loopbackHostnameUpdate !== undefined
				? { loopbackHostname: loopbackHostnameUpdate }
				: {}),
		};
	}
	const canPreserveSecret =
		form.hasSavedClientSecret &&
		form.preserveSavedClientSecret &&
		isMcpOAuthClientIdentityUnchanged(form);
	return {
		clientId,
		...(canPreserveSecret ? { preserveClientSecret: true } : {}),
		allowedScopes: allowedScopes ?? null,
		...(loopbackHostnameUpdate !== undefined
			? { loopbackHostname: loopbackHostnameUpdate }
			: {}),
	};
}
