import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { BasicLogger } from "@cline/shared";
import { resolveClineDataDir, resolveClineDir } from "@cline/shared/storage";
import {
	COMPOSIO_RECOMMENDED_TOOLKITS,
	type ComposioCatalogResponse,
	type ComposioCatalogToolkit,
	type ComposioConnectResponse,
	type ComposioIntegrationStatus,
	type ComposioIntegrationSummary,
	type ComposioStatusResponse,
	type ComposioToolkitSlug,
	findRecommendedToolkit,
	isComposioToolkitSlug,
} from "../webview/lib/composio-types";

/**
 * Management plane for Composio-backed integrations (Gmail, Google Calendar,
 * GitHub).
 *
 * The sidecar owns the OAuth handshake and connection bookkeeping, but agent
 * sessions run in the shared Hub daemon, so the sidecar cannot register tools
 * in-process. Instead, connection state plus the fetched tool schemas are
 * persisted to `<cline-data>/settings/composio.json`, and a single-file plugin
 * is materialized into `~/.cline/plugins/` that reads that file at session
 * start and registers one tool per connected Composio tool. New sessions pick
 * the plugin up automatically; running sessions keep their frozen tool set.
 */

const COMPOSIO_STATE_FILE_NAME = "composio.json";
const COMPOSIO_PLUGIN_FILE_NAME = "composio-tools.ts";
/** Mirrors `PLUGINS_DIRECTORY_NAME` in `@cline/shared` (not exported). */
const PLUGINS_DIRECTORY_NAME = "plugins";
/** How long the background waiter gives the user to finish the browser flow. */
const CONNECT_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
/** Cap on tools materialized per toolkit; Composio orders by importance. */
const TOOLS_PER_TOOLKIT_LIMIT = 20;
const MAX_TOOL_DESCRIPTION_LENGTH = 1024;

type StoredComposioTool = {
	slug: string;
	name?: string;
	description?: string;
	version?: string;
	inputParameters?: Record<string, unknown>;
};

type StoredComposioToolkit = {
	connectedAccountId: string;
	connectedAt: string;
	/** Display metadata captured from the catalog at connect time. */
	name?: string;
	logo?: string;
	tools: StoredComposioTool[];
};

type StoredComposioState = {
	apiKey?: string;
	/**
	 * Where the stored key came from. "user" keys are entered in Settings and
	 * only change through Settings; "environment" keys are copies of the
	 * COMPOSIO_API_KEY env var (persisted so the plugin, which runs in the Hub
	 * process without the sidecar's environment, can execute tools) and are
	 * re-synced against the env var on every read — rotated when it changes,
	 * dropped when it disappears.
	 */
	apiKeySource?: "user" | "environment";
	/** Stable per-install Composio user id; generated on first configuration. */
	userId?: string;
	toolkits?: Partial<Record<string, StoredComposioToolkit>>;
};

type PendingConnection = {
	attemptId: string;
	connectedAccountId: string;
	redirectUrl?: string;
	startedAt: number;
};

type ComposioConnectionRequest = {
	id: string;
	redirectUrl?: string | null;
	waitForConnection: (timeout?: number) => Promise<unknown>;
};

/** Minimal surface of the `@composio/core` client this module uses; the SDK is
 * loaded lazily so sidecar startup does not pay its import cost. */
type ComposioToolkitCatalogItem = {
	slug: string;
	name: string;
	meta?: {
		description?: string;
		logo?: string;
		toolsCount?: number;
		categories?: Array<{ slug: string; name: string }>;
	};
};

type ComposioClient = {
	toolkits: {
		authorize: (
			userId: string,
			toolkitSlug: string,
		) => Promise<ComposioConnectionRequest>;
		/** Catalog listing (the SDK overloads `get`; the query form returns an
		 * array of toolkits). */
		get: (query: {
			sortBy?: "usage" | "alphabetically";
			limit?: number;
			category?: string;
		}) => Promise<ComposioToolkitCatalogItem[]>;
	};
	authConfigs: {
		list: (query?: { toolkit?: string }) => Promise<{
			items: Array<{ id: string; isComposioManaged?: boolean }>;
		}>;
		create: (
			toolkit: string,
			options: { type: "use_composio_managed_auth"; name?: string },
		) => Promise<{ id: string }>;
	};
	tools: {
		getRawComposioTools: (query: {
			toolkits: string[];
			limit?: number;
		}) => Promise<
			Array<{
				slug: string;
				name?: string;
				description?: string;
				version?: string;
				inputParameters?: unknown;
			}>
		>;
	};
	connectedAccounts: {
		list: (query?: { userIds?: string[]; toolkitSlugs?: string[] }) => Promise<{
			items: Array<{
				id: string;
				status: string;
				isDisabled?: boolean;
				toolkit: { slug: string };
			}>;
		}>;
		link: (
			userId: string,
			authConfigId: string,
		) => Promise<ComposioConnectionRequest>;
		delete: (id: string) => Promise<unknown>;
	};
};

const pendingConnections = new Map<ComposioToolkitSlug, PendingConnection>();
const lastConnectionErrors = new Map<ComposioToolkitSlug, string>();

/** Usage-ranked toolkit catalog, cached per key since it changes rarely. */
const CATALOG_TTL_MS = 60 * 60 * 1000;
const CATALOG_FETCH_LIMIT = 500;
let catalogCache: {
	apiKey: string;
	fetchedAt: number;
	entries: ComposioCatalogToolkit[];
} | null = null;

let cachedClient: { apiKey: string; client: ComposioClient } | null = null;

async function getComposioClient(apiKey: string): Promise<ComposioClient> {
	if (cachedClient?.apiKey === apiKey) {
		return cachedClient.client;
	}
	const { Composio } = await import("@composio/core");
	const client = new Composio({ apiKey }) as unknown as ComposioClient;
	cachedClient = { apiKey, client };
	return client;
}

/** Composio SDK errors embed the raw response JSON ("401 {...}"); pull out
 * the human-readable message when one is present. */
function formatComposioError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const jsonStart = message.indexOf("{");
	if (jsonStart !== -1) {
		try {
			const parsed = JSON.parse(message.slice(jsonStart)) as {
				error?: { message?: unknown };
				message?: unknown;
			};
			const nested = parsed.error?.message ?? parsed.message;
			if (typeof nested === "string" && nested.trim()) {
				return nested.trim();
			}
		} catch {
			// Fall through to the raw message.
		}
	}
	return message;
}

export function parseComposioToolkitSlug(value: unknown): ComposioToolkitSlug {
	const slug = String(value ?? "")
		.trim()
		.toLowerCase();
	if (!isComposioToolkitSlug(slug)) {
		throw new Error(`Invalid Composio toolkit slug: ${String(value)}`);
	}
	return slug;
}

/** Composio retired the legacy connection-create endpoint that
 * `toolkits.authorize()` uses for Composio-managed OAuth auth configs; the
 * error directs callers to the connected-account link flow instead. */
function isLegacyConnectionEndpointError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("connected_accounts/link");
}

/** A custom auth config is the org's own OAuth app registered in Composio —
 * the consent screen then shows that app's branding ("Authorize Cline")
 * instead of Composio's shared OAuth app ("Authorize Composio"). */
async function findCustomAuthConfigId(
	client: ComposioClient,
	toolkit: ComposioToolkitSlug,
): Promise<string | undefined> {
	try {
		const existing = await client.authConfigs.list({ toolkit });
		return existing.items?.find((item) => item.isComposioManaged === false)?.id;
	} catch {
		// Lookup is an optimization; the authorize path below still works.
		return undefined;
	}
}

async function resolveToolkitAuthConfigId(
	client: ComposioClient,
	toolkit: ComposioToolkitSlug,
): Promise<string> {
	const existing = await client.authConfigs.list({ toolkit });
	const items = existing.items ?? [];
	// Prefer a custom (org-branded) auth config when both kinds exist.
	const preferred =
		items.find((item) => item.isComposioManaged === false) ?? items[0];
	if (preferred?.id) {
		return preferred.id;
	}
	const created = await client.authConfigs.create(toolkit, {
		type: "use_composio_managed_auth",
	});
	return created.id;
}

/**
 * Start an OAuth connection for a toolkit.
 *
 * When a custom auth config exists (the org's own OAuth app), connect through
 * it directly with the connected-account link flow so the consent screen
 * carries the org's branding. Otherwise fall back to `toolkits.authorize()`
 * (which finds or creates a Composio-managed auth config in one call) — and
 * because Composio retired that method's connection-create endpoint for
 * managed OAuth configs, retry the specific rejection through the link flow
 * against the same auth config.
 */
export async function initiateToolkitConnection(
	client: ComposioClient,
	userId: string,
	toolkit: ComposioToolkitSlug,
	logger?: BasicLogger,
): Promise<ComposioConnectionRequest> {
	const customAuthConfigId = await findCustomAuthConfigId(client, toolkit);
	if (customAuthConfigId) {
		logger?.log?.(
			`composio connect ${toolkit}: using custom auth config ${customAuthConfigId}`,
		);
		return await client.connectedAccounts.link(userId, customAuthConfigId);
	}
	try {
		return await client.toolkits.authorize(userId, toolkit);
	} catch (error) {
		if (!isLegacyConnectionEndpointError(error)) {
			throw error;
		}
		logger?.log?.(
			`composio authorize ${toolkit}: legacy endpoint retired, using connected-account link flow`,
		);
		const authConfigId = await resolveToolkitAuthConfigId(client, toolkit);
		return await client.connectedAccounts.link(userId, authConfigId);
	}
}

// ── Persisted state ──────────────────────────────────────────────────────

export function resolveComposioStatePath(): string {
	return join(resolveClineDataDir(), "settings", COMPOSIO_STATE_FILE_NAME);
}

function readComposioState(): StoredComposioState {
	const path = resolveComposioStatePath();
	if (!existsSync(path)) {
		return {};
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null
			? (parsed as StoredComposioState)
			: {};
	} catch {
		return {};
	}
}

function writeComposioState(state: StoredComposioState): void {
	const path = resolveComposioStatePath();
	mkdirSync(dirname(path), { recursive: true });
	// The file holds the Composio API key; keep it owner-readable only.
	writeFileSync(path, `${JSON.stringify(state, null, "\t")}\n`, {
		mode: 0o600,
	});
}

function resolveEnvComposioApiKey(): string | undefined {
	return process.env.COMPOSIO_API_KEY?.trim() || undefined;
}

/**
 * Keep an environment-sourced key in sync with the COMPOSIO_API_KEY env var:
 * adopt it when no user key is stored, rotate the stored copy when the env
 * var changes, and drop it when the env var disappears. A key the user typed
 * into Settings ("user" source) always wins and is never touched here.
 *
 * Persists (and re-syncs the plugin file) only when something changed.
 */
function reconcileEnvApiKey(
	state: StoredComposioState,
	logger?: BasicLogger,
): void {
	const envKey = resolveEnvComposioApiKey();
	let changed = false;
	if (state.apiKeySource === "environment") {
		if (!envKey) {
			delete state.apiKey;
			delete state.apiKeySource;
			changed = true;
		} else if (state.apiKey !== envKey) {
			state.apiKey = envKey;
			changed = true;
		}
	} else if (!state.apiKey && envKey) {
		state.apiKey = envKey;
		state.apiKeySource = "environment";
		changed = true;
	}
	if (changed && state.apiKey && !state.userId) {
		state.userId = `cline-desktop-${randomUUID()}`;
	}
	if (changed) {
		writeComposioState(state);
		syncComposioPluginFile(state, logger);
		logger?.log?.(
			state.apiKey
				? "composio api key adopted from COMPOSIO_API_KEY environment variable"
				: "composio api key dropped: COMPOSIO_API_KEY environment variable is gone",
		);
	}
}

function readReconciledComposioState(
	logger?: BasicLogger,
): StoredComposioState {
	const state = readComposioState();
	reconcileEnvApiKey(state, logger);
	return state;
}

// ── Status ───────────────────────────────────────────────────────────────

function summarizeToolkit(
	state: StoredComposioState,
	slug: ComposioToolkitSlug,
): ComposioIntegrationSummary {
	const recommended = findRecommendedToolkit(slug);
	const stored = state.toolkits?.[slug];
	let status: ComposioIntegrationStatus = "not_connected";
	if (pendingConnections.has(slug)) {
		status = "pending";
	} else if (stored) {
		status = "connected";
	}
	const catalogEntry = catalogCache?.entries.find(
		(entry) => entry.slug === slug,
	);
	return {
		toolkit: slug,
		name: recommended?.name ?? stored?.name ?? catalogEntry?.name ?? slug,
		description: recommended?.description ?? catalogEntry?.description ?? "",
		logo: stored?.logo ?? catalogEntry?.logo,
		recommended: Boolean(recommended),
		status,
		connectedAccountId: stored?.connectedAccountId,
		connectedAt: stored?.connectedAt,
		toolNames: stored?.tools.map((tool) => tool.name?.trim() || tool.slug),
		error: lastConnectionErrors.get(slug),
	};
}

function buildStatusResponse(
	state: StoredComposioState,
): ComposioStatusResponse {
	// Recommended toolkits are always listed; any other toolkit appears while
	// it is connected or mid-connection (so the catalog UI can join on it).
	const slugs = new Set<ComposioToolkitSlug>(
		COMPOSIO_RECOMMENDED_TOOLKITS.map((entry) => entry.slug),
	);
	for (const slug of Object.keys(state.toolkits ?? {})) {
		slugs.add(slug);
	}
	for (const slug of pendingConnections.keys()) {
		slugs.add(slug);
	}
	return {
		configured: Boolean(state.apiKey),
		keySource: state.apiKey ? (state.apiKeySource ?? "user") : undefined,
		integrations: [...slugs].map((slug) => summarizeToolkit(state, slug)),
	};
}

export async function getComposioStatus(options?: {
	refresh?: boolean;
	logger?: BasicLogger;
}): Promise<ComposioStatusResponse> {
	const state = readReconciledComposioState(options?.logger);
	if (!options?.refresh || !state.apiKey || !state.userId) {
		return buildStatusResponse(state);
	}
	// Reconcile with Composio: connections can be revoked (or added) from the
	// Composio dashboard without this app knowing.
	try {
		const client = await getComposioClient(state.apiKey);
		const accounts = await client.connectedAccounts.list({
			userIds: [state.userId],
		});
		const activeByToolkit = new Map<string, string>();
		for (const account of accounts.items ?? []) {
			if (account.status === "ACTIVE" && !account.isDisabled) {
				activeByToolkit.set(account.toolkit.slug.toLowerCase(), account.id);
			}
		}
		let changed = false;
		const toolkits = { ...(state.toolkits ?? {}) };
		const slugsToReconcile = new Set<ComposioToolkitSlug>([
			...Object.keys(toolkits),
			...activeByToolkit.keys(),
		]);
		for (const slug of slugsToReconcile) {
			const remoteAccountId = activeByToolkit.get(slug);
			const stored = toolkits[slug];
			if (stored && !remoteAccountId) {
				delete toolkits[slug];
				changed = true;
			} else if (
				remoteAccountId &&
				(!stored || stored.connectedAccountId !== remoteAccountId) &&
				!pendingConnections.has(slug)
			) {
				toolkits[slug] = {
					connectedAccountId: remoteAccountId,
					connectedAt: new Date().toISOString(),
					...lookupCatalogDisplayInfo(slug),
					tools: await fetchToolkitTools(client, slug),
				};
				changed = true;
			}
		}
		if (changed) {
			state.toolkits = toolkits;
			writeComposioState(state);
			syncComposioPluginFile(state, options?.logger);
		}
	} catch (error) {
		options?.logger?.log?.(
			`composio status refresh failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return buildStatusResponse(state);
}

// ── Toolkit catalog ──────────────────────────────────────────────────────

function lookupCatalogDisplayInfo(slug: ComposioToolkitSlug): {
	name?: string;
	logo?: string;
} {
	const entry = catalogCache?.entries.find((item) => item.slug === slug);
	return { name: entry?.name, logo: entry?.logo };
}

async function ensureToolkitCatalog(
	client: ComposioClient,
	apiKey: string,
): Promise<ComposioCatalogToolkit[]> {
	if (
		catalogCache &&
		catalogCache.apiKey === apiKey &&
		Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS
	) {
		return catalogCache.entries;
	}
	const items = await client.toolkits.get({
		sortBy: "usage",
		limit: CATALOG_FETCH_LIMIT,
	});
	const seen = new Set<string>();
	const entries: ComposioCatalogToolkit[] = [];
	for (const item of items ?? []) {
		const slug = item?.slug?.trim().toLowerCase();
		if (!slug || seen.has(slug) || !isComposioToolkitSlug(slug)) {
			continue;
		}
		seen.add(slug);
		entries.push({
			slug,
			name: item.name?.trim() || slug,
			description: item.meta?.description?.trim() || undefined,
			logo: item.meta?.logo || undefined,
			categories: item.meta?.categories
				?.map((category) => category.name)
				.filter(Boolean),
			toolsCount: item.meta?.toolsCount,
			recommended: Boolean(findRecommendedToolkit(slug)),
		});
	}
	catalogCache = { apiKey, fetchedAt: Date.now(), entries };
	return entries;
}

/** The browsable toolkit catalog (usage-ranked), for the Connectors UI. */
export async function listComposioToolkits(
	logger?: BasicLogger,
): Promise<ComposioCatalogResponse> {
	const state = readReconciledComposioState(logger);
	if (!state.apiKey) {
		return { configured: false, toolkits: [] };
	}
	const client = await getComposioClient(state.apiKey);
	try {
		return {
			configured: true,
			toolkits: await ensureToolkitCatalog(client, state.apiKey),
		};
	} catch (error) {
		throw new Error(
			`Could not load the Composio connector catalog: ${formatComposioError(error)}`,
		);
	}
}

// ── API key management ───────────────────────────────────────────────────

export async function setComposioApiKey(
	apiKey: string,
	logger?: BasicLogger,
): Promise<ComposioStatusResponse> {
	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("apiKey is required");
	}
	const client = await getComposioClient(trimmed);
	try {
		// Any authenticated call proves the key; listing is cheap and also
		// warms the reconcile below.
		await client.connectedAccounts.list();
	} catch (error) {
		cachedClient = null;
		throw new Error(
			`Composio rejected this API key: ${formatComposioError(error)}`,
		);
	}
	const state = readComposioState();
	state.apiKey = trimmed;
	state.apiKeySource = "user";
	if (!state.userId) {
		state.userId = `cline-desktop-${randomUUID()}`;
	}
	writeComposioState(state);
	syncComposioPluginFile(state, logger);
	return await getComposioStatus({ refresh: true, logger });
}

export async function clearComposioApiKey(
	logger?: BasicLogger,
): Promise<ComposioStatusResponse> {
	const state = readComposioState();
	// Keep the userId so reconnecting later finds the same Composio user, but
	// drop the key and materialized connections: without a key the tools
	// cannot execute (and connections are only valid within one key's
	// Composio project anyway).
	delete state.apiKey;
	delete state.apiKeySource;
	state.toolkits = {};
	writeComposioState(state);
	pendingConnections.clear();
	lastConnectionErrors.clear();
	cachedClient = null;
	catalogCache = null;
	syncComposioPluginFile(state, logger);
	// A COMPOSIO_API_KEY env var immediately takes over as the fallback key;
	// the response reflects that so the UI shows the environment source.
	reconcileEnvApiKey(state, logger);
	return buildStatusResponse(state);
}

// ── Connect / disconnect ─────────────────────────────────────────────────

export async function connectComposioToolkit(
	toolkit: ComposioToolkitSlug,
	logger?: BasicLogger,
): Promise<ComposioConnectResponse> {
	const state = readReconciledComposioState(logger);
	if (!state.apiKey || !state.userId) {
		throw new Error(
			"Add a Composio API key in Settings (or set COMPOSIO_API_KEY in the sidecar environment) before connecting an integration.",
		);
	}
	const existingPending = pendingConnections.get(toolkit);
	if (existingPending) {
		return {
			redirectUrl: existingPending.redirectUrl,
			status: buildStatusResponse(state),
		};
	}
	lastConnectionErrors.delete(toolkit);
	const client = await getComposioClient(state.apiKey);
	let connectionRequest: ComposioConnectionRequest;
	try {
		connectionRequest = await initiateToolkitConnection(
			client,
			state.userId,
			toolkit,
			logger,
		);
	} catch (error) {
		throw new Error(
			`Could not start the ${toolkit} connection: ${formatComposioError(error)}`,
		);
	}
	const redirectUrl = connectionRequest.redirectUrl?.trim() || undefined;
	if (!redirectUrl) {
		// No browser step needed (e.g. the account is already authorized on
		// Composio's side) — finalize right away.
		await finalizeToolkitConnection(
			client,
			toolkit,
			connectionRequest.id,
			logger,
		);
		return {
			alreadyConnected: true,
			status: buildStatusResponse(readComposioState()),
		};
	}

	const attemptId = randomUUID();
	pendingConnections.set(toolkit, {
		attemptId,
		connectedAccountId: connectionRequest.id,
		redirectUrl,
		startedAt: Date.now(),
	});

	// The OAuth flow finishes in the external browser, which cannot navigate
	// the app back. Wait for Composio to report the connection in the
	// background; the webview polls `status` to observe the flip.
	void (async () => {
		try {
			await connectionRequest.waitForConnection(CONNECT_WAIT_TIMEOUT_MS);
			if (pendingConnections.get(toolkit)?.attemptId !== attemptId) {
				return; // Cancelled or superseded while we waited.
			}
			await finalizeToolkitConnection(
				client,
				toolkit,
				connectionRequest.id,
				logger,
			);
		} catch (error) {
			if (pendingConnections.get(toolkit)?.attemptId !== attemptId) {
				return;
			}
			const reason = formatComposioError(error);
			lastConnectionErrors.set(
				toolkit,
				`Connection was not completed: ${reason}`,
			);
			logger?.log?.(`composio connect ${toolkit} failed: ${reason}`);
		} finally {
			if (pendingConnections.get(toolkit)?.attemptId === attemptId) {
				pendingConnections.delete(toolkit);
			}
		}
	})();

	return { redirectUrl, status: buildStatusResponse(state) };
}

export function cancelComposioConnect(toolkit: ComposioToolkitSlug): void {
	pendingConnections.delete(toolkit);
}

export async function disconnectComposioToolkit(
	toolkit: ComposioToolkitSlug,
	logger?: BasicLogger,
): Promise<ComposioStatusResponse> {
	pendingConnections.delete(toolkit);
	lastConnectionErrors.delete(toolkit);
	const state = readReconciledComposioState(logger);
	const stored = state.toolkits?.[toolkit];
	if (stored && state.apiKey) {
		try {
			const client = await getComposioClient(state.apiKey);
			await client.connectedAccounts.delete(stored.connectedAccountId);
		} catch (error) {
			// The account may already be gone on Composio's side; local
			// removal is what actually turns the tools off.
			logger?.log?.(
				`composio disconnect ${toolkit}: remote delete failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (state.toolkits) {
		delete state.toolkits[toolkit];
	}
	writeComposioState(state);
	syncComposioPluginFile(state, logger);
	return buildStatusResponse(state);
}

// ── Tool materialization ─────────────────────────────────────────────────

async function fetchToolkitTools(
	client: ComposioClient,
	toolkit: ComposioToolkitSlug,
): Promise<StoredComposioTool[]> {
	const rawTools = await client.tools.getRawComposioTools({
		toolkits: [toolkit],
		limit: TOOLS_PER_TOOLKIT_LIMIT,
	});
	const tools: StoredComposioTool[] = [];
	for (const raw of rawTools) {
		if (!raw?.slug) {
			continue;
		}
		const description = raw.description?.trim();
		tools.push({
			slug: raw.slug,
			name: raw.name?.trim() || undefined,
			description:
				description && description.length > MAX_TOOL_DESCRIPTION_LENGTH
					? `${description.slice(0, MAX_TOOL_DESCRIPTION_LENGTH)}…`
					: description || undefined,
			version:
				typeof raw.version === "string" && raw.version.trim()
					? raw.version.trim()
					: undefined,
			inputParameters:
				typeof raw.inputParameters === "object" && raw.inputParameters !== null
					? (raw.inputParameters as Record<string, unknown>)
					: undefined,
		});
	}
	return tools;
}

async function finalizeToolkitConnection(
	client: ComposioClient,
	toolkit: ComposioToolkitSlug,
	connectedAccountId: string,
	logger?: BasicLogger,
): Promise<void> {
	const tools = await fetchToolkitTools(client, toolkit);
	const state = readComposioState();
	state.toolkits = {
		...(state.toolkits ?? {}),
		[toolkit]: {
			connectedAccountId,
			connectedAt: new Date().toISOString(),
			...lookupCatalogDisplayInfo(toolkit),
			tools,
		},
	};
	writeComposioState(state);
	syncComposioPluginFile(state, logger);
	logger?.log?.(`composio connected ${toolkit} with ${tools.length} tool(s)`);
}

// ── Plugin materialization ───────────────────────────────────────────────

export function resolveComposioPluginPath(): string {
	return join(
		resolveClineDir(),
		PLUGINS_DIRECTORY_NAME,
		COMPOSIO_PLUGIN_FILE_NAME,
	);
}

function syncComposioPluginFile(
	state: StoredComposioState,
	logger?: BasicLogger,
): void {
	const pluginPath = resolveComposioPluginPath();
	const hasConnectedToolkit =
		Boolean(state.apiKey) &&
		Object.values(state.toolkits ?? {}).some(
			(toolkit) => toolkit && toolkit.tools.length > 0,
		);
	try {
		if (!hasConnectedToolkit) {
			rmSync(pluginPath, { force: true });
			return;
		}
		mkdirSync(dirname(pluginPath), { recursive: true });
		writeFileSync(pluginPath, COMPOSIO_PLUGIN_SOURCE);
	} catch (error) {
		logger?.log?.(
			`composio plugin sync failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Source of the single-file plugin the Hub loads into every new session. It
 * is static: all dynamic state (API key, user id, tool schemas) is read from
 * composio.json at session start, so connecting or disconnecting a toolkit
 * never needs to rewrite this file — only create or remove it.
 *
 * The plugin executes tools against Composio's REST API directly (the
 * `@composio/core` package is not resolvable from `~/.cline/plugins/`); the
 * endpoint below is the same one the official SDK calls.
 */
export const COMPOSIO_PLUGIN_SOURCE = `// AUTO-GENERATED by the Cline desktop app — do not edit.
// Exposes Composio-connected integrations (Gmail, Google Calendar, GitHub)
// as agent tools. Manage connections from the desktop app under
// Settings -> Customize -> Integrations. Connection state and tool schemas
// live in <cline-data>/settings/composio.json; deleting that file (or
// disconnecting every integration) turns these tools off.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentPlugin, createTool } from "@cline/core";
import { resolveClineDataDir } from "@cline/shared/storage";

const COMPOSIO_BASE_URL = (
	process.env.COMPOSIO_BASE_URL || "https://backend.composio.dev"
).replace(/\\/+$/, "");

type StoredTool = {
	slug: string;
	name?: string;
	description?: string;
	version?: string;
	inputParameters?: Record<string, unknown>;
};

type StoredState = {
	apiKey?: string;
	userId?: string;
	toolkits?: Record<
		string,
		{ connectedAccountId?: string; tools?: StoredTool[] } | undefined
	>;
};

function loadComposioState(): StoredState | undefined {
	try {
		const path = join(resolveClineDataDir(), "settings", "composio.json");
		if (!existsSync(path)) {
			return undefined;
		}
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null
			? (parsed as StoredState)
			: undefined;
	} catch {
		return undefined;
	}
}

async function executeComposioTool(
	apiKey: string,
	userId: string,
	tool: StoredTool,
	input: unknown,
): Promise<unknown> {
	const url =
		COMPOSIO_BASE_URL +
		"/api/v3.1/tools/execute/" +
		encodeURIComponent(tool.slug);
	const body: Record<string, unknown> = {
		user_id: userId,
		arguments: input && typeof input === "object" ? input : {},
	};
	if (tool.version) {
		body.version = tool.version;
	}
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});
	} catch (error) {
		return {
			successful: false,
			error:
				"Composio request failed: " +
				(error instanceof Error ? error.message : String(error)),
		};
	}
	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}
	if (!response.ok) {
		const preview =
			parsed !== undefined
				? JSON.stringify(parsed).slice(0, 600)
				: text.slice(0, 600);
		return {
			successful: false,
			error:
				"Composio returned HTTP " +
				String(response.status) +
				" for " +
				tool.slug +
				(preview ? ": " + preview : ""),
		};
	}
	return parsed ?? { successful: true };
}

const plugin: AgentPlugin = {
	name: "composio-tools",
	manifest: { capabilities: ["tools"] },
	setup(api) {
		const state = loadComposioState();
		// The desktop app persists the effective key into composio.json, but a
		// COMPOSIO_API_KEY exported to this (Hub) process works as a fallback.
		const apiKey =
			state?.apiKey || (process.env.COMPOSIO_API_KEY || "").trim() || undefined;
		const userId = state?.userId;
		if (!state || !apiKey || !userId || !state.toolkits) {
			return;
		}
		const registered = new Set<string>();
		for (const [toolkitSlug, toolkitState] of Object.entries(
			state.toolkits,
		)) {
			if (!toolkitState || !toolkitState.connectedAccountId) {
				continue;
			}
			for (const tool of toolkitState.tools ?? []) {
				if (!tool || !tool.slug) {
					continue;
				}
				const toolName = tool.slug
					.toLowerCase()
					.replace(/[^a-z0-9_]/g, "_");
				if (registered.has(toolName)) {
					continue;
				}
				registered.add(toolName);
				api.registerTool(
					createTool({
						name: toolName,
						description:
							(tool.description || tool.name || tool.slug) +
							" (" +
							toolkitSlug +
							" account connected via Composio)",
						inputSchema: (tool.inputParameters ?? {
							type: "object",
							properties: {},
						}) as never,
						timeoutMs: 120_000,
						// Composio tools can have side effects (send an email,
						// open an issue); never auto-retry them.
						retryable: false,
						execute: (input: unknown) =>
							executeComposioTool(apiKey, userId, tool, input),
					}),
				);
			}
		}
	},
};

export { plugin };
export default plugin;
`;
