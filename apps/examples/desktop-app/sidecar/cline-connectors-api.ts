import { isClineAccountFeatureEnabled } from "@cline/core";
import { type BasicLogger, FeatureFlag } from "@cline/shared";
import type { ComposioToolkitSlug } from "../webview/lib/composio-types";
import {
	type ClineAuthTelemetryContext,
	getClineAccountId,
	resolveConnectorsApiAuth,
} from "./cline-auth";

export type ConnectorsRequestContext = ClineAuthTelemetryContext & {
	accountId?: string;
};

/**
 * Client for the Cline API connectors proxy (`/api/v1/connectors/*`).
 *
 * The proxy holds the Composio project API key server-side and derives the
 * Composio `user_id` from the authenticated Cline account on every call —
 * the reason this proxy exists: Composio project keys cannot be user-scoped,
 * so any client-held key (however permission-scoped) would allow executing
 * tools as other users. See the backend contract notes on each function.
 *
 * The backend must also enforce `CLINE_COMPOSIO_BETA` for the authenticated
 * account; client-side rollout checks are not an authorization boundary.
 *
 * Every function resolves the account bearer token itself (shared
 * refresh-aware resolver) and throws {@link ConnectorsApiError} with the
 * HTTP status on failure; a missing sign-in surfaces as status 401.
 */

const CONNECTORS_API_PATH = "/api/v1/connectors";
const CONNECTORS_PAGE_SIZE = 200;

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
	is_disabled?: boolean;
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
	input_parameters?: unknown;
};

type ConnectorPage<T> = {
	items: T[];
	nextToken: string;
};

async function requestConnectorsApi<T>(
	method: "GET" | "POST" | "DELETE",
	path: string,
	options: {
		body?: unknown;
		ctx?: ConnectorsRequestContext;
	} = {},
): Promise<T> {
	const accountId = options.ctx?.accountId ?? getClineAccountId();
	if (!accountId || getClineAccountId() !== accountId) {
		throw new ConnectorsApiError("The signed-in Cline account changed.", 401);
	}
	const auth = await resolveConnectorsApiAuth(options.ctx);
	if (!auth) {
		throw new ConnectorsApiError(
			"Sign in to your Cline account to use connectors.",
			401,
		);
	}
	// Revocation remains available for cleanup after beta access is removed.
	if (
		method !== "DELETE" &&
		!(await isClineAccountFeatureEnabled(FeatureFlag.CLINE_COMPOSIO_BETA))
	) {
		throw new ConnectorsApiError(
			"Composio connectors are not enabled for this account.",
			403,
		);
	}
	// Auth resolution and flag evaluation can yield while the user signs out
	// or switches accounts. Never submit an old operation with the new token.
	if (getClineAccountId() !== accountId || auth.accountId !== accountId) {
		throw new ConnectorsApiError("The signed-in Cline account changed.", 401);
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
		// The live backend's error envelope is `{"error": "..."}` (confirmed
		// against staging); `message` is kept as a fallback in case a future
		// route uses that shape instead.
		const body = typeof parsed === "object" && parsed !== null ? parsed : {};
		const message =
			(typeof (body as { error?: unknown }).error === "string" &&
				(body as { error: string }).error) ||
			(typeof (body as { message?: unknown }).message === "string" &&
				(body as { message: string }).message) ||
			`Cline API returned HTTP ${response.status} for ${method} ${path}`;
		throw new ConnectorsApiError(message, response.status);
	}
	if (method === "DELETE" && response.status === 204) {
		return undefined as T;
	}
	// Management routes return lib.Response<T>; execution relays the provider
	// body directly and is handled by the core tool extension instead.
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		"data" in parsed &&
		(parsed as { success?: unknown }).success === true
	) {
		return (parsed as { data: T }).data;
	}
	throw new ConnectorsApiError(
		`Invalid connectors response for ${method} ${path}`,
	);
}

/** Complete usage-ranked catalog, including apps not yet connected by anyone. */
export async function fetchConnectableToolkits(
	ctx?: ConnectorsRequestContext,
): Promise<ConnectorCatalogEntry[]> {
	return listAllConnectorPages<ConnectorCatalogEntry>("/toolkits", ctx);
}

/**
 * `POST /api/v1/connectors/connections` — initiate an OAuth connection.
 * The server selects or creates an auth config and derives `user_id`
 * from the authenticated account, never accepting it from the client.
 */
export async function initiateConnection(
	toolkit: ComposioToolkitSlug,
	ctx?: ConnectorsRequestContext,
): Promise<ConnectorInitiateResult> {
	return await requestConnectorsApi<ConnectorInitiateResult>(
		"POST",
		"/connections",
		{ body: { toolkit }, ctx },
	);
}

/**
 * `GET /api/v1/connectors/connections` — the caller's connected
 * accounts only. Backend contract: the server scopes to the caller's derived
 * user_id. Fetch every page before returning: reconciliation treats absence
 * from this complete list as "revoked remotely". Failed or malformed pages
 * must reject the whole operation, never return a partial list.
 */
export async function listConnections(
	ctx?: ConnectorsRequestContext,
): Promise<ConnectorConnection[]> {
	return listAllConnectorPages<ConnectorConnection>("/connections", ctx);
}

async function listAllConnectorPages<T>(
	path: "/connections" | "/toolkits" | `/toolkits/${string}/tools`,
	ctx?: ConnectorsRequestContext,
): Promise<T[]> {
	ctx = { ...ctx, accountId: ctx?.accountId ?? getClineAccountId() };
	const items: T[] = [];
	const seenCursors = new Set<string>();
	let cursor = "";
	do {
		const query = new URLSearchParams({ limit: String(CONNECTORS_PAGE_SIZE) });
		if (cursor) query.set("cursor", cursor);
		const page = await requestConnectorPage<T>(`${path}?${query}`, ctx);
		items.push(...page.items);
		cursor = page.nextToken;
		if (cursor && seenCursors.has(cursor)) {
			throw new ConnectorsApiError(
				"Connectors pagination returned a repeated cursor.",
			);
		}
		seenCursors.add(cursor);
	} while (cursor);
	return items;
}

async function requestConnectorPage<T>(
	path: string,
	ctx?: ConnectorsRequestContext,
): Promise<ConnectorPage<T>> {
	const page = await requestConnectorsApi<ConnectorPage<T>>("GET", path, {
		ctx,
	});
	if (
		!page ||
		!Array.isArray(page.items) ||
		typeof page.nextToken !== "string"
	) {
		throw new ConnectorsApiError(`Invalid connectors page for ${path}`);
	}
	return page;
}

/**
 * `DELETE /api/v1/connectors/connections/{id}` — delete AND revoke.
 * Backend contract: ownership-checked against the caller's derived user_id,
 * then deleted with `revoke_on_delete=true` so the upstream OAuth grant (the
 * actual Gmail/Calendar/GitHub token) is revoked, not just the Composio
 * record. A 404 means the account is already gone; callers treat that as a
 * confirmed revocation.
 */
export async function deleteConnection(
	connectedAccountId: string,
	ctx?: ConnectorsRequestContext,
): Promise<void> {
	await requestConnectorsApi<unknown>(
		"DELETE",
		`/connections/${encodeURIComponent(connectedAccountId)}`,
		{ ctx },
	);
}

/**
 * `GET /api/v1/connectors/toolkits/{slug}/tools` — complete toolkit schemas
 * in provider order. Fetch every page before
 * returning so failed pagination cannot persist an incomplete tool set.
 */
export async function listToolkitTools(
	toolkit: ComposioToolkitSlug,
	ctx?: ConnectorsRequestContext,
): Promise<ConnectorToolSchema[]> {
	return listAllConnectorPages<ConnectorToolSchema>(
		`/toolkits/${encodeURIComponent(toolkit)}/tools`,
		ctx,
	);
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
		ctx?: ConnectorsRequestContext;
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
				!connection.is_disabled
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
