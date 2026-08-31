import {
	type AuthorizeMcpServerOAuthOptions,
	type AuthorizeMcpServerOAuthResult,
	authorizeMcpServerOAuth,
} from "@cline/core";

export type McpOAuthCancellationReason =
	| "user"
	| "server-disabled"
	| "superseded"
	| "owner-closed";

export function shouldRestoreEnabledStateAfterOAuthCancellation(
	wasDisabled: boolean,
	reason: McpOAuthCancellationReason,
): boolean {
	return !wasDisabled && reason === "user";
}

type PendingMcpOAuthAuthorization = {
	controller: AbortController;
	owner?: object;
	cancellationReason?: McpOAuthCancellationReason;
};

const pendingAuthorizations = new Map<string, PendingMcpOAuthAuthorization>();

export class McpOAuthAuthorizationCancelledError extends Error {
	constructor(
		serverName: string,
		readonly reason: McpOAuthCancellationReason,
	) {
		super(`MCP OAuth authorization was cancelled for "${serverName}".`);
		this.name = "McpOAuthAuthorizationCancelledError";
	}
}

export type McpOAuthAuthorizationDependencies = {
	authorize: (
		options: AuthorizeMcpServerOAuthOptions,
	) => Promise<AuthorizeMcpServerOAuthResult>;
};

const defaultDependencies: McpOAuthAuthorizationDependencies = {
	authorize: authorizeMcpServerOAuth,
};

/**
 * Owns the lifetime of a desktop MCP browser authorization. Only an explicit
 * call to this function can open the browser; ordinary server enable/connect
 * attempts only persist the SDK's `authorizationRequired` status.
 */
export async function runCancellableMcpOAuthAuthorization(
	options: Omit<AuthorizeMcpServerOAuthOptions, "signal">,
	owner?: object,
	dependencies: McpOAuthAuthorizationDependencies = defaultDependencies,
): Promise<AuthorizeMcpServerOAuthResult> {
	const serverName = options.serverName.trim();
	if (!serverName) {
		throw new Error("MCP server name cannot be empty.");
	}

	cancelMcpOAuthAuthorizationForReason(serverName, "superseded");
	const entry: PendingMcpOAuthAuthorization = {
		controller: new AbortController(),
		owner,
	};
	pendingAuthorizations.set(serverName, entry);

	try {
		try {
			return await dependencies.authorize({
				...options,
				serverName,
				signal: entry.controller.signal,
			});
		} catch (error) {
			if (entry.controller.signal.aborted) {
				throw new McpOAuthAuthorizationCancelledError(
					serverName,
					entry.cancellationReason ?? "superseded",
				);
			}
			throw error;
		}
	} finally {
		if (pendingAuthorizations.get(serverName) === entry) {
			pendingAuthorizations.delete(serverName);
		}
	}
}

/** Cancels the pending browser callback flow for one MCP server, if present. */
export function cancelMcpOAuthAuthorization(serverName: string): boolean {
	return cancelMcpOAuthAuthorizationForReason(serverName, "user");
}

export function cancelMcpOAuthAuthorizationForReason(
	serverName: string,
	reason: McpOAuthCancellationReason,
): boolean {
	const entry = pendingAuthorizations.get(serverName);
	if (!entry) {
		return false;
	}
	entry.cancellationReason = reason;
	entry.controller.abort();
	pendingAuthorizations.delete(serverName);
	return true;
}

/** Cancels MCP OAuth flows started by a webview connection that went away. */
export function cancelMcpOAuthAuthorizationsForOwner(owner: object): number {
	let cancelled = 0;
	for (const [serverName, entry] of pendingAuthorizations) {
		if (entry.owner === owner) {
			entry.cancellationReason = "owner-closed";
			entry.controller.abort();
			pendingAuthorizations.delete(serverName);
			cancelled += 1;
		}
	}
	return cancelled;
}
