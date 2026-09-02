import type { BasicLogger } from "@cline/shared";
import type { ComposioToolkitSlug } from "../webview/lib/composio-types";
import {
	type ClineAuthTelemetryContext,
	resolveConnectorsApiAuth,
} from "./cline-auth";

/**
 * Client for the Cline API connectors proxy (`/v1/connectors/composio/*`).
 *
 * The proxy holds the Composio project API key server-side and derives the
 * Composio `user_id` from the authenticated Cline account on every call —
 * the reason this proxy exists: Composio project keys cannot be user-scoped,
 * so any client-held key (however permission-scoped) would allow executing
 * tools as other users. See the backend contract notes on each function.
 *
 * Every function resolves the account bearer token itself (shared
 * refresh-aware resolver) and throws {@link ConnectorsApiError} with the
 * HTTP status on failure; a missing sign-in surfaces as status 401.
 */

const CONNECTORS_API_PATH = "/v1/connectors/composio";

/** How often the connect waiter polls the caller's connections while the
 * user finishes the OAuth flow in their browser. */
const CONNECTION_POLL_INTERVAL_MS = 4_000;

export class ConnectorsApiError extends Error {
	readonly status?: number;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "ConnectorsApiError";
		this.status = status;
	}
}

export type ConnectorCatalogEntry = {
	slug: string;
	name: string;
	description?: string;
	logo?: string;
	categories?: string[];
	toolsCount?: number;
};

export type ConnectorConnection = {
	id: string;
	toolkit: { slug: string };
	status: string;
	isDisabled?: boolean;
};

export type ConnectorInitiateResult = {
	connectedAccountId: string;
	/** Absent when the account was already authorized on Composio's side and
	 * no browser step is needed. */
	redirectUrl?: string;
};

export type ConnectorToolSchema = {
	slug: string;
	name?: string;
	description?: string;
	version?: string;
	inputParameters?: unknown;
};

async function requestConnectorsApi<T>(
	method: "GET" | "POST" | "DELETE",
	path: string,
	options: {
		body?: unknown;
		ctx?: ClineAuthTelemetryContext;
	} = {},
): Promise<T> {
	const auth = await resolveConnectorsApiAuth(options.ctx);
	if (!auth) {
		throw new ConnectorsApiError(
			"Sign in to your Cline account to use connectors.",
			401,
		);
	}
	let response: Response;
	try {
		response = await fetch(`${auth.baseUrl}${CONNECTORS_API_PATH}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${auth.token}`,
				...(options.body !== undefined
					? { "content-type": "application/json" }
					: {}),
			},
			...(options.body !== undefined
				? { body: JSON.stringify(options.body) }
				: {}),
		});
	} catch (error) {
		throw new ConnectorsApiError(
			`Cline API request failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}
	if (!response.ok) {
		const message =
			(typeof parsed === "object" &&
				parsed !== null &&
				typeof (parsed as { message?: unknown }).message === "string" &&
				(parsed as { message: string }).message) ||
			`Cline API returned HTTP ${response.status} for ${method} ${path}`;
		throw new ConnectorsApiError(message, response.status);
	}
	return parsed as T;
}

/**
 * `GET /v1/connectors/composio/toolkits` — the connectable catalog,
 * usage-ranked. Backend contract: server filters to toolkits a Connect can
 * finish (Composio-managed credentials or a project auth config) and caches
 * upstream for ~1h; entitlement (internal accounts / rollout cohort) is
 * enforced server-side on every route.
 */
export async function fetchConnectableToolkits(
	ctx?: ClineAuthTelemetryContext,
): Promise<ConnectorCatalogEntry[]> {
	const response = await requestConnectorsApi<{
		toolkits?: ConnectorCatalogEntry[];
	}>("GET", "/toolkits", { ctx });
	return response.toolkits ?? [];
}

/**
 * `POST /v1/connectors/composio/connections` — initiate an OAuth connection.
 * Backend contract: prefer the org's custom auth config for the toolkit,
 * else the Composio-managed link flow; `user_id` is derived server-side from
 * the authenticated account, never accepted from the client.
 */
export async function initiateConnection(
	toolkit: ComposioToolkitSlug,
	ctx?: ClineAuthTelemetryContext,
): Promise<ConnectorInitiateResult> {
	return await requestConnectorsApi<ConnectorInitiateResult>(
		"POST",
		"/connections",
		{ body: { toolkit }, ctx },
	);
}

/**
 * `GET /v1/connectors/composio/connections` — the caller's connected
 * accounts only. Backend contract: the server scopes to the caller's derived
 * user_id and follows Composio pagination to completion, so this list is
 * authoritative — reconciliation may treat absence as "revoked remotely".
 */
export async function listConnections(
	ctx?: ClineAuthTelemetryContext,
): Promise<ConnectorConnection[]> {
	const response = await requestConnectorsApi<{
		connections?: ConnectorConnection[];
	}>("GET", "/connections", { ctx });
	return response.connections ?? [];
}

/**
 * `DELETE /v1/connectors/composio/connections/{id}` — delete AND revoke.
 * Backend contract: ownership-checked against the caller's derived user_id,
 * then deleted with `revoke_on_delete=true` so the upstream OAuth grant (the
 * actual Gmail/Calendar/GitHub token) is revoked, not just the Composio
 * record. A 404 means the account is already gone; callers treat that as a
 * confirmed revocation.
 */
export async function deleteConnection(
	connectedAccountId: string,
	ctx?: ClineAuthTelemetryContext,
): Promise<void> {
	await requestConnectorsApi<unknown>(
		"DELETE",
		`/connections/${encodeURIComponent(connectedAccountId)}`,
		{ ctx },
	);
}

/**
 * `GET /v1/connectors/composio/toolkits/{slug}/tools` — the toolkit's tool
 * schemas (server caps at 20, Composio importance order), fetched at connect
 * time and persisted locally for session-bootstrap registration.
 */
export async function listToolkitTools(
	toolkit: ComposioToolkitSlug,
	ctx?: ClineAuthTelemetryContext,
): Promise<ConnectorToolSchema[]> {
	const response = await requestConnectorsApi<{
		tools?: ConnectorToolSchema[];
	}>("GET", `/toolkits/${encodeURIComponent(toolkit)}/tools`, { ctx });
	return response.tools ?? [];
}

/**
 * Waits for a just-initiated connection to turn ACTIVE by polling the
 * caller's connections while the user finishes the OAuth flow in the
 * external browser (which cannot navigate the app back). Resolves when the
 * account is ACTIVE; throws on timeout or when `shouldContinue` reports the
 * attempt no longer owns its slot (cancelled/superseded). Transient poll
 * failures are retried until the deadline — auth refresh happens per poll
 * through the shared resolver, so a token expiring mid-wait heals itself.
 */
export async function waitForConnectionActive(
	connectedAccountId: string,
	options: {
		timeoutMs: number;
		pollIntervalMs?: number;
		shouldContinue?: () => boolean;
		logger?: BasicLogger;
		ctx?: ClineAuthTelemetryContext;
	},
): Promise<void> {
	const pollIntervalMs = options.pollIntervalMs ?? CONNECTION_POLL_INTERVAL_MS;
	const deadline = Date.now() + options.timeoutMs;
	while (Date.now() < deadline) {
		if (options.shouldContinue && !options.shouldContinue()) {
			throw new ConnectorsApiError("Connection attempt was superseded.");
		}
		try {
			const connections = await listConnections(options.ctx);
			const connection = connections.find(
				(entry) => entry.id === connectedAccountId,
			);
			if (
				connection &&
				connection.status === "ACTIVE" &&
				!connection.isDisabled
			) {
				return;
			}
		} catch (error) {
			// Transient (network, token refresh in flight): keep polling until
			// the deadline. A definitive 401 also lands here — retrying is
			// harmless and sign-in mid-wait then completes the flow.
			options.logger?.log?.(
				`composio connect wait poll failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}
	throw new ConnectorsApiError(
		"Timed out waiting for the connection to be authorized.",
	);
}
