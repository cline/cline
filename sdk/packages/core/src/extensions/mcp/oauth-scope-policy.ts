import { extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

// RFC 6749 section 3.3 scope-token: printable ASCII excluding DQUOTE and "\\".
export const MCP_OAUTH_SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

export class McpOAuthScopePolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpOAuthScopePolicyError";
	}
}

export function isMcpOAuthScopeToken(value: string): boolean {
	return MCP_OAUTH_SCOPE_TOKEN_PATTERN.test(value);
}

/**
 * Returns one canonical policy representation for config comparisons, state
 * binding, authorization requests, and persisted-token checks.
 */
export function normalizeMcpOAuthAllowedScopes(
	allowedScopes: readonly string[] | undefined,
): string[] | undefined {
	if (allowedScopes === undefined) {
		return undefined;
	}
	if (allowedScopes.length === 0) {
		throw new McpOAuthScopePolicyError(
			"MCP OAuth allowedScopes must contain at least one scope.",
		);
	}
	const unique = new Set<string>();
	for (const scope of allowedScopes) {
		if (!isMcpOAuthScopeToken(scope)) {
			throw new McpOAuthScopePolicyError(
				`Invalid MCP OAuth scope token: ${JSON.stringify(scope)}.`,
			);
		}
		if (unique.has(scope)) {
			throw new McpOAuthScopePolicyError(
				`Duplicate MCP OAuth scope in allowedScopes: ${JSON.stringify(scope)}.`,
			);
		}
		unique.add(scope);
	}
	return [...unique].sort();
}

export function areMcpOAuthScopePoliciesEqual(
	left: readonly string[] | undefined,
	right: readonly string[] | undefined,
): boolean {
	if (left === undefined || right === undefined) {
		return left === right;
	}
	if (left.length !== right.length) {
		return false;
	}
	const leftSorted = [...left].sort();
	const rightSorted = [...right].sort();
	return leftSorted.every((scope, index) => scope === rightSorted[index]);
}

function parseScopeValue(scopeValue: string, source: string): string[] {
	const scopes = scopeValue.trim().split(/\s+/).filter(Boolean);
	if (
		scopes.length === 0 ||
		scopes.some((scope) => !isMcpOAuthScopeToken(scope))
	) {
		throw new McpOAuthScopePolicyError(
			`MCP OAuth ${source} contains an invalid scope value.`,
		);
	}
	return scopes;
}

/** Rejects any requested or granted scope outside the configured maximum. */
export function assertMcpOAuthScopesAllowed(
	scopeValue: unknown,
	allowedScopes: readonly string[] | undefined,
	source: string,
): void {
	if (scopeValue === undefined || allowedScopes === undefined) {
		return;
	}
	if (typeof scopeValue !== "string") {
		throw new McpOAuthScopePolicyError(
			`MCP OAuth ${source} contains a non-string scope value.`,
		);
	}
	const normalized = normalizeMcpOAuthAllowedScopes(allowedScopes);
	if (!normalized) {
		return;
	}
	const allowed = new Set(normalized);
	const outsidePolicy = parseScopeValue(scopeValue, source).filter(
		(scope) => !allowed.has(scope),
	);
	if (outsidePolicy.length > 0) {
		throw new McpOAuthScopePolicyError(
			`MCP OAuth ${source} requested scopes outside allowedScopes: ${outsidePolicy.sort().join(", ")}.`,
		);
	}
}

function responseWithScopeChallenge(
	response: Response,
	header: string | null,
	policyScope: string,
): Response {
	const headers = new Headers(response.headers);
	const bearerParameters = header
		? header
				.trim()
				.replace(/^Bearer\s*/i, "")
				.trim()
		: "";
	headers.set(
		"WWW-Authenticate",
		`Bearer scope="${policyScope}"${bearerParameters ? `, ${bearerParameters}` : ""}`,
	);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/**
 * Constrains the MCP SDK's scope selection strategy without depending on its
 * private transport fields. The SDK gives an explicit Bearer challenge scope
 * precedence over broad protected-resource metadata, so a missing scope is
 * normalized to the configured policy and an explicit upscope is rejected.
 */
export function createMcpOAuthScopePolicyFetch(
	baseFetch: FetchLike | undefined,
	allowedScopes: readonly string[] | undefined,
): FetchLike | undefined {
	const normalized = normalizeMcpOAuthAllowedScopes(allowedScopes);
	if (!normalized) {
		return baseFetch;
	}
	const fetchFn = baseFetch ?? globalThis.fetch;
	const policyScope = normalized.join(" ");

	return async (url, init) => {
		const response = await fetchFn(url, init);
		if (response.status !== 401 && response.status !== 403) {
			return response;
		}

		const header = response.headers.get("WWW-Authenticate");
		if (header && !/^\s*Bearer(?:\s+|$)/i.test(header)) {
			if (response.status === 401) {
				await response.body?.cancel().catch(() => undefined);
				throw new McpOAuthScopePolicyError(
					"MCP OAuth scope policy cannot authorize a non-Bearer challenge.",
				);
			}
			return response;
		}

		const { scope, error } = extractWWWAuthenticateParams(response);
		const declaresScope =
			header !== null && /(?:^|[,\s])scope\s*=/i.test(header);
		if (declaresScope && !scope) {
			await response.body?.cancel().catch(() => undefined);
			throw new McpOAuthScopePolicyError(
				"MCP OAuth WWW-Authenticate challenge contains an invalid scope parameter.",
			);
		}
		if (scope) {
			try {
				assertMcpOAuthScopesAllowed(scope, normalized, "challenge");
			} catch (policyError) {
				await response.body?.cancel().catch(() => undefined);
				throw policyError;
			}
			return response;
		}

		if (response.status === 401 || error === "insufficient_scope") {
			return responseWithScopeChallenge(response, header, policyScope);
		}
		return response;
	};
}
