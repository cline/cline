import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	isClineAccountFeatureEnabled,
	resolveComposioToolsStatePath,
} from "@cline/core";
import { type BasicLogger, FeatureFlag } from "@cline/shared";
import { resolveClineDir } from "@cline/shared/storage";
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
import {
	type ClineAuthTelemetryContext,
	getClineAccountId,
} from "./cline-auth";
import {
	type ConnectorCatalogEntry,
	ConnectorsApiError,
	deleteConnection,
	fetchConnectableToolkits,
	initiateConnection,
	listConnections,
	listToolkitTools,
	waitForConnectionActive,
} from "./cline-connectors-api";

/**
 * Management plane for Composio-backed integrations (Gmail, Google Calendar,
 * GitHub).
 *
 * Every Composio call goes through the Cline API connectors proxy
 * (`cline-connectors-api.ts`), which holds the Composio project key
 * server-side and derives the Composio `user_id` from the authenticated
 * account — a client-held key can't be user-scoped, so the proxy is what
 * keeps one install from acting as another user. There is no local API key.
 *
 * The sidecar still owns connection bookkeeping and the OAuth-completion
 * wait, and persists connection state plus fetched tool schemas to
 * `<cline-data>/settings/composio/<account-hash>.json`, which core's built-in
 * `composio-tools` extension (`@cline/core`, composio-tools-extension.ts)
 * reads at session start to register one tool per connected Composio tool.
 * New sessions pick state changes up automatically; running sessions keep
 * their frozen tool set. The persisted file no longer holds an API key; the
 * proxy resolves the account bearer token per call, and the composio-tools
 * extension executes tools through the same proxy.
 */

/** Where pre–in-process-registration builds materialized a drop-in plugin;
 * kept only so those legacy files can be cleaned up. */
const LEGACY_COMPOSIO_PLUGIN_RELATIVE_PATH = ["plugins", "composio-tools.ts"];
/** How long the background waiter gives the user to finish the browser flow. */
const CONNECT_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TOOL_DESCRIPTION_LENGTH = 1024;

type StoredComposioTool = {
	slug: string;
	name?: string;
	description?: string;
	version?: string;
	input_parameters?: Record<string, unknown>;
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
	toolkits?: Partial<Record<string, StoredComposioToolkit>>;
	/**
	 * Connected-account ids from OAuth attempts the user cancelled (or that a
	 * disconnect / sign-out abandoned) while the browser flow could still
	 * complete. Reconciliation refuses to import these and keeps trying to
	 * revoke them remotely. Persisted so a sidecar restart cannot forget a
	 * cancellation, and kept until the account is confirmed deleted on
	 * Composio's side — never evicted on a count or age bound, because an
	 * abandoned browser flow can complete arbitrarily late. Growth is
	 * therefore limited to attempts whose remote deletion has not been
	 * confirmed yet.
	 */
	cancelledAccountIds?: string[];
};

type PendingConnection = {
	attemptId: string;
	connectedAccountId: string;
	redirectUrl?: string;
	startedSequence: number;
	/** The webview connection that started this attempt, if any. When that
	 * connection goes away (webview closed/reloaded, transport drop) the
	 * attempt is abandoned — matching how provider and MCP OAuth waits are
	 * cancelled for a departing owner. Identity only; never dereferenced. */
	owner?: object;
};

/** Every operation retains its account scope across asynchronous work. */
type AccountScope = {
	readonly accountId: string;
	pendingConnections: Map<ComposioToolkitSlug, PendingConnection>;
	/** Owns a toolkit before initiation returns its connected-account ID. */
	connectInitiationsInFlight: Set<ComposioToolkitSlug>;
	lastConnectionErrors: Map<ComposioToolkitSlug, string>;
	/** Orders async intents without relying on wall-clock time. */
	operationSequence: number;
	/** Stops older snapshots from restoring a disconnected toolkit. */
	lastDisconnectSequence: Map<ComposioToolkitSlug, number>;
	catalogCache: { fetchedAt: number; entries: ComposioCatalogToolkit[] } | null;
	configuredCache: { checkedAt: number; configured: boolean } | null;
};
const accountScopes = new Map<string, AccountScope>();
const CATALOG_TTL_MS = 60 * 60 * 1000;
const CONFIGURED_TTL_MS = 60 * 1000;

function getAccountScope(): AccountScope | undefined {
	const accountId = getClineAccountId();
	if (!accountId) return undefined;
	let scope = accountScopes.get(accountId);
	if (!scope) {
		scope = {
			accountId,
			pendingConnections: new Map(),
			connectInitiationsInFlight: new Set(),
			lastConnectionErrors: new Map(),
			operationSequence: 0,
			lastDisconnectSequence: new Map(),
			catalogCache: null,
			configuredCache: null,
		};
		accountScopes.set(accountId, scope);
	}
	return scope;
}

function parseToolInputParameters(
	value: unknown,
): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function toStoredTool(raw: {
	slug: string;
	name?: string;
	description?: string;
	version?: string;
	input_parameters?: unknown;
}): StoredComposioTool | undefined {
	if (!raw?.slug) {
		return undefined;
	}
	const description = raw.description?.trim();
	return {
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
		input_parameters: parseToolInputParameters(raw.input_parameters),
	};
}

function formatConnectorsError(error: unknown): string {
	if (error instanceof ConnectorsApiError) {
		return error.message;
	}
	return error instanceof Error ? error.message : String(error);
}

/** Test hook: clears the module-level availability/catalog caches and the
 * in-memory attempt maps so each test starts from a clean slate. */
export function __resetComposioCachesForTesting(): void {
	accountScopes.clear();
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

// ── Persisted state ──────────────────────────────────────────────────────

function readComposioState(scope: AccountScope): StoredComposioState {
	const path = resolveComposioToolsStatePath(scope.accountId);
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

function writeComposioState(
	scope: AccountScope,
	state: StoredComposioState,
): void {
	const path = resolveComposioToolsStatePath(scope.accountId);
	mkdirSync(dirname(path), { recursive: true });
	// The file no longer holds an API key, but connection metadata is still
	// user data; keep it owner-readable only, unchanged from before.
	writeFileSync(path, `${JSON.stringify(state, null, "\t")}\n`, {
		mode: 0o600,
	});
}

/**
 * The single mutation path for the persisted state: read the current file,
 * apply `mutate`, persist the result — with no await anywhere between read
 * and write, so the event loop serializes every mutation in this process. A
 * writer can therefore never clobber a tombstone or connection that another
 * path persisted while this one was suspended on network I/O. Callers must
 * apply changes inside `mutate` on the freshly read state — never by
 * persisting a snapshot they held across an await.
 */
function updateComposioState(
	scope: AccountScope,
	mutate: (state: StoredComposioState) => void,
): StoredComposioState {
	const state = readComposioState(scope);
	mutate(state);
	writeComposioState(scope, state);
	return state;
}

/** Remembers a cancelled/abandoned OAuth attempt's connected-account id so
 * reconciliation can never import it. Entries are never evicted on a count
 * or age bound (the abandoned browser flow can complete arbitrarily late);
 * they are dropped only via {@link pruneConfirmedCancelledAccount} once the
 * account is confirmed gone remotely. Mutates `state`; callers persist it. */
function rememberCancelledAccountId(
	state: StoredComposioState,
	accountId: string,
): void {
	const ids = state.cancelledAccountIds ?? [];
	if (!ids.includes(accountId)) {
		state.cancelledAccountIds = [...ids, accountId];
	}
}

/** Mutating counterpart of {@link rememberCancelledAccountId}; returns
 * whether the tombstone was present. Callers persist `state`. */
function forgetCancelledAccountId(
	state: StoredComposioState,
	accountId: string,
): boolean {
	const remaining = (state.cancelledAccountIds ?? []).filter(
		(id) => id !== accountId,
	);
	if (remaining.length === (state.cancelledAccountIds?.length ?? 0)) {
		return false;
	}
	if (remaining.length > 0) {
		state.cancelledAccountIds = remaining;
	} else {
		delete state.cancelledAccountIds;
	}
	return true;
}

/** Drops a tombstone whose account is confirmed gone on Composio's side: a
 * deleted connected account can never turn ACTIVE, so the tombstone has
 * nothing left to guard. Confirmed deletion is the only way tombstones are
 * removed. */
function pruneConfirmedCancelledAccount(
	scope: AccountScope,
	accountId: string,
): void {
	updateComposioState(scope, (state) => {
		forgetCancelledAccountId(state, accountId);
	});
}

/**
 * Best-effort remote revocation for cancelled/abandoned OAuth attempts,
 * through the proxy's delete (which revokes upstream credentials). Returns
 * true when the account is confirmed gone (deleted now, or already gone / a
 * 404) — the caller then prunes its tombstone. A failure is logged, not
 * thrown: the persisted tombstone keeps the account from ever materializing
 * tools locally, and the status-refresh reconciliation retries the deletion
 * whenever the proxy still reports the account.
 */
async function revokeConnectedAccountQuietly(
	scope: AccountScope,
	accountId: string,
	ctx?: ClineAuthTelemetryContext,
): Promise<boolean> {
	try {
		await deleteConnection(accountId, { ...ctx, accountId: scope.accountId });
		return true;
	} catch (error) {
		if (isAccountAlreadyGoneError(error)) {
			return true;
		}
		ctx?.logger?.log?.(
			`composio: revoking cancelled account ${accountId} failed: ${formatConnectorsError(error)}`,
		);
		return false;
	}
}

/**
 * Abandon every in-flight OAuth attempt: tombstone the attempts' account ids
 * (their browser flows may still complete afterwards) and revoke them
 * remotely in the background, pruning each tombstone once its revocation is
 * confirmed. The tombstones are what guarantee the accounts can never
 * materialize local tools; the revocations are best-effort cleanup. Mutates
 * `state`; the caller persists it.
 */
function abandonPendingConnections(
	scope: AccountScope,
	state: StoredComposioState,
	ctx?: ClineAuthTelemetryContext,
): void {
	for (const pending of scope.pendingConnections.values()) {
		rememberCancelledAccountId(state, pending.connectedAccountId);
		void revokeConnectedAccountQuietly(
			scope,
			pending.connectedAccountId,
			ctx,
		).then((confirmedGone) => {
			if (confirmedGone) {
				pruneConfirmedCancelledAccount(scope, pending.connectedAccountId);
			}
		});
	}
	scope.pendingConnections.clear();
}

/**
 * Earlier builds materialized a drop-in plugin at
 * `~/.cline/plugins/composio-tools.ts`; connector tools now register inside
 * core at session start, so a leftover file would double-register the tools
 * on hosts that can load drop-in plugins (and fail noisily on hosts that
 * cannot). Best-effort removal on every reconciled read — a forced unlink
 * of a missing file is a single cheap syscall.
 */
function removeLegacyComposioPluginQuietly(logger?: BasicLogger): void {
	try {
		rmSync(join(resolveClineDir(), ...LEGACY_COMPOSIO_PLUGIN_RELATIVE_PATH), {
			force: true,
		});
	} catch (error) {
		logger?.log?.(
			`composio: removing the legacy tools plugin failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function readReconciledComposioState(
	scope: AccountScope,
	logger?: BasicLogger,
): StoredComposioState {
	removeLegacyComposioPluginQuietly(logger);
	return readComposioState(scope);
}

// ── Availability (entitlement) ─────────────────────────────────────────────

/**
 * Whether connectors are available to this install. The proxy enforces
 * entitlement for the signed-in Cline account on every route; a `listConnections` probe both proves sign-in and
 * exercises that gate. 401/403 → not available. Result is cached briefly to
 * spare the network the UI's frequent status polls; a forced refresh (or
 * cache miss) re-probes.
 */
async function isConnectorsAvailable(
	scope: AccountScope,
	options?: {
		forceRefresh?: boolean;
		ctx?: ClineAuthTelemetryContext;
	},
): Promise<boolean> {
	if (getClineAccountId() !== scope.accountId) return false;
	if (!(await isClineAccountFeatureEnabled(FeatureFlag.CLINE_COMPOSIO_BETA))) {
		scope.configuredCache = null;
		scope.catalogCache = null;
		return false;
	}
	if (getClineAccountId() !== scope.accountId) return false;
	if (
		!options?.forceRefresh &&
		scope.configuredCache &&
		Date.now() - scope.configuredCache.checkedAt < CONFIGURED_TTL_MS
	) {
		return scope.configuredCache.configured;
	}
	let configured: boolean;
	try {
		await listConnections({ ...options?.ctx, accountId: scope.accountId });
		configured = true;
	} catch (error) {
		if (
			error instanceof ConnectorsApiError &&
			(error.status === 401 || error.status === 403)
		) {
			configured = false;
		} else {
			// A transient failure (offline, 5xx) shouldn't flip the feature off
			// and tear down the UI; assume still-available and let the actual
			// operation surface the error. Never cache this guess.
			return (
				getClineAccountId() === scope.accountId &&
				(scope.configuredCache?.configured ?? true)
			);
		}
	}
	if (getClineAccountId() !== scope.accountId) return false;
	scope.configuredCache = { checkedAt: Date.now(), configured };
	if (!configured) {
		// Signed out or un-entitled: connections in the state file belong to a
		// session that can no longer act on them. Drop them so no stale
		// connectors are reported (and so the composio-tools extension, which
		// also fails closed without a token, and the UI agree).
		scope.catalogCache = null;
		clearConnectorStateForSignedOut(scope);
	}
	return configured;
}

function clearConnectorStateForSignedOut(scope: AccountScope): void {
	const state = readComposioState(scope);
	if (!state.toolkits || Object.keys(state.toolkits).length === 0) {
		return;
	}
	// Abandon in-flight attempts (tombstone + best-effort revoke) and drop the
	// materialized toolkits; keep tombstones so a completed browser flow for a
	// just-cancelled attempt still can't be imported after re-sign-in.
	updateComposioState(scope, (s) => {
		abandonPendingConnections(scope, s);
		s.toolkits = {};
	});
}

// ── Status ───────────────────────────────────────────────────────────────

function summarizeToolkit(
	scope: AccountScope,
	state: StoredComposioState,
	slug: ComposioToolkitSlug,
): ComposioIntegrationSummary {
	const recommended = findRecommendedToolkit(slug);
	const stored = state.toolkits?.[slug];
	let status: ComposioIntegrationStatus = "not_connected";
	if (scope.pendingConnections.has(slug)) {
		status = "pending";
	} else if (stored) {
		status = "connected";
	}
	const catalogEntry = scope.catalogCache?.entries.find(
		(entry) => entry.slug === slug,
	);
	// A connected toolkit with zero materialized tools is a wedge, not a
	// healthy state (sessions get nothing) — surface it instead of letting
	// the card look fine. Reconciliation re-fetches the schemas on the next
	// status refresh (see getComposioStatus).
	const zeroToolsWarning =
		status === "connected" && stored && stored.tools.length === 0
			? "Connected, but no tools were retrieved from Composio yet. They are re-fetched automatically; if this persists, disconnect and reconnect."
			: undefined;
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
		error: scope.lastConnectionErrors.get(slug) ?? zeroToolsWarning,
	};
}

function buildStatusResponse(
	scope: AccountScope,
	state: StoredComposioState,
	configured: boolean,
): ComposioStatusResponse {
	if (getClineAccountId() !== scope.accountId)
		return { configured: false, integrations: [] };
	// Recommended toolkits are always listed; any other toolkit appears while
	// it is connected or mid-connection (so the catalog UI can join on it).
	const slugs = new Set<ComposioToolkitSlug>(
		COMPOSIO_RECOMMENDED_TOOLKITS.map((entry) => entry.slug),
	);
	for (const slug of Object.keys(state.toolkits ?? {})) {
		slugs.add(slug);
	}
	for (const slug of scope.pendingConnections.keys()) {
		slugs.add(slug);
	}
	return {
		configured,
		integrations: [...slugs].map((slug) =>
			summarizeToolkit(scope, state, slug),
		),
	};
}

export async function getComposioStatus(options?: {
	refresh?: boolean;
	logger?: BasicLogger;
	telemetry?: ClineAuthTelemetryContext["telemetry"];
}): Promise<ComposioStatusResponse> {
	const scope = getAccountScope();
	if (!scope) {
		return { configured: false, integrations: [] };
	}
	const ctx: ClineAuthTelemetryContext = {
		logger: options?.logger,
		telemetry: options?.telemetry,
	};
	const configured = await isConnectorsAvailable(scope, {
		forceRefresh: options?.refresh,
		ctx,
	});
	if (!configured) {
		return { configured: false, integrations: [] };
	}
	const state = readReconciledComposioState(scope, options?.logger);
	if (!options?.refresh || !configured) {
		return buildStatusResponse(scope, state, configured);
	}
	// Reconcile with the proxy: connections can be revoked (or added) from the
	// Composio dashboard, or by another device, without this app knowing.
	// Refresh every active toolkit's schemas too: persisted tools may be
	// incomplete or outdated. Ordinary status polling still uses local state.
	try {
		const refreshSequence = ++scope.operationSequence;
		const connections = await listConnections({
			...ctx,
			accountId: scope.accountId,
		});
		const cancelledIds = new Set(state.cancelledAccountIds ?? []);
		const activeByToolkit = new Map<string, string>();
		for (const account of connections) {
			if (cancelledIds.has(account.id)) {
				// A cancelled attempt the proxy still knows about — its browser
				// flow may have completed after the cancel. Retry the revocation
				// instead of importing it; once the delete is confirmed the
				// tombstone has nothing left to guard and is pruned.
				const confirmedGone = await revokeConnectedAccountQuietly(
					scope,
					account.id,
					ctx,
				);
				if (confirmedGone) {
					pruneConfirmedCancelledAccount(scope, account.id);
				}
				continue;
			}
			if (account.status === "ACTIVE" && !account.is_disabled) {
				activeByToolkit.set(account.toolkit.slug.toLowerCase(), account.id);
			}
		}
		// Reconciliation is computed as per-slug DELTAS against the state
		// snapshot taken when this refresh started (the baseline), never as a
		// whole toolkit map to assign: an OAuth connection that finalizes
		// while the tool fetches below are in flight lives only in the fresh
		// state, and replacing the map wholesale would silently discard it.
		const startToolkits = state.toolkits ?? {};
		const baselineIdBySlug = new Map<ComposioToolkitSlug, string | undefined>();
		const removals: ComposioToolkitSlug[] = [];
		const imports = new Map<ComposioToolkitSlug, StoredComposioToolkit>();
		const slugsToReconcile = new Set<ComposioToolkitSlug>([
			...Object.keys(startToolkits),
			...activeByToolkit.keys(),
		]);
		for (const slug of slugsToReconcile) {
			const remoteAccountId = activeByToolkit.get(slug);
			const stored = startToolkits[slug];
			baselineIdBySlug.set(slug, stored?.connectedAccountId);
			if (stored && cancelledIds.has(stored.connectedAccountId)) {
				// A stored entry carrying a tombstoned account (imported by a
				// refresh that raced an attempt's failure) must never stay
				// reported as installed — its account is abandoned/revoked.
				removals.push(slug);
			} else if (stored && !remoteAccountId) {
				// The proxy list is authoritative (client-side pagination to
				// completion), so absence means revoked remotely.
				removals.push(slug);
			} else if (
				remoteAccountId &&
				!scope.pendingConnections.has(slug) &&
				// A connect mid-initiation owns the slug (its pending entry does
				// not exist yet): a redirect-less attempt can already be ACTIVE
				// remotely while its finalize is still fetching tools, and
				// importing it here would keep it installed even if that
				// finalize then fails and abandons the account.
				!scope.connectInitiationsInFlight.has(slug) &&
				// The remote snapshot predates a local disconnect of this
				// toolkit; writing it back would resurrect the connection.
				(scope.lastDisconnectSequence.get(slug) ?? 0) < refreshSequence
			) {
				// A same-account re-fetch keeps the original connection metadata.
				const sameAccount = Boolean(
					stored && stored.connectedAccountId === remoteAccountId,
				);
				imports.set(slug, {
					connectedAccountId: remoteAccountId,
					connectedAt:
						sameAccount && stored?.connectedAt
							? stored.connectedAt
							: new Date().toISOString(),
					...lookupCatalogDisplayInfo(scope, slug),
					...(sameAccount && stored?.name ? { name: stored.name } : {}),
					...(sameAccount && stored?.logo ? { logo: stored.logo } : {}),
					tools: await fetchToolkitTools(scope, slug, ctx),
				});
			}
		}
		if (removals.length > 0 || imports.size > 0) {
			// The tool fetches above are slow enough for a connect, disconnect,
			// cancel, or sign-out to have landed meanwhile. Each delta is
			// applied to the freshly read state only if that slug still matches
			// the baseline it was decided against (per-slug compare-and-swap),
			// so concurrent changes survive this write.
			const next = updateComposioState(scope, (fresh) => {
				const freshToolkits = { ...(fresh.toolkits ?? {}) };
				const freshCancelled = new Set(fresh.cancelledAccountIds ?? []);
				for (const slug of removals) {
					// Remove only the exact account this refresh saw missing; a
					// connection finalized mid-refresh has a different id and
					// must survive.
					if (
						freshToolkits[slug]?.connectedAccountId ===
						baselineIdBySlug.get(slug)
					) {
						delete freshToolkits[slug];
					}
				}
				for (const [slug, imported] of imports) {
					if (
						freshToolkits[slug]?.connectedAccountId !==
						baselineIdBySlug.get(slug)
					) {
						continue; // The slug changed mid-refresh; keep the newer state.
					}
					if (
						(scope.lastDisconnectSequence.get(slug) ?? 0) >= refreshSequence
					) {
						continue; // Disconnected mid-refresh.
					}
					if (
						scope.pendingConnections.has(slug) ||
						scope.connectInitiationsInFlight.has(slug)
					) {
						continue; // A new attempt started mid-refresh; let it finish.
					}
					if (freshCancelled.has(imported.connectedAccountId)) {
						continue; // Cancelled mid-refresh.
					}
					freshToolkits[slug] = imported;
				}
				fresh.toolkits = freshToolkits;
			});
			return buildStatusResponse(scope, next, configured);
		}
	} catch (error) {
		options?.logger?.log?.(
			`composio status refresh failed: ${formatConnectorsError(error)}`,
		);
	}
	return buildStatusResponse(scope, state, configured);
}

// ── Toolkit catalog ──────────────────────────────────────────────────────

function lookupCatalogDisplayInfo(
	scope: AccountScope,
	slug: ComposioToolkitSlug,
): {
	name?: string;
	logo?: string;
} {
	const entry = scope.catalogCache?.entries.find((item) => item.slug === slug);
	return { name: entry?.name, logo: entry?.logo };
}

function toCatalogToolkit(
	entry: ConnectorCatalogEntry,
): ComposioCatalogToolkit {
	return {
		slug: entry.slug,
		name: entry.name?.trim() || entry.slug,
		description: entry.description?.trim() || undefined,
		logo: entry.logo || undefined,
		categories: entry.categories?.filter(Boolean),
		toolsCount: entry.toolsCount,
		recommended: Boolean(findRecommendedToolkit(entry.slug)),
	};
}

async function ensureToolkitCatalog(
	scope: AccountScope,
	ctx: ClineAuthTelemetryContext,
): Promise<ComposioCatalogToolkit[]> {
	if (
		scope.catalogCache &&
		Date.now() - scope.catalogCache.fetchedAt < CATALOG_TTL_MS
	) {
		return getClineAccountId() === scope.accountId
			? scope.catalogCache.entries
			: [];
	}
	const items = await fetchConnectableToolkits({
		...ctx,
		accountId: scope.accountId,
	});
	const entries: ComposioCatalogToolkit[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		const slug = item?.slug?.trim().toLowerCase();
		if (!slug || seen.has(slug) || !isComposioToolkitSlug(slug)) {
			continue;
		}
		seen.add(slug);
		entries.push(toCatalogToolkit({ ...item, slug }));
	}
	scope.catalogCache = { fetchedAt: Date.now(), entries };
	return getClineAccountId() === scope.accountId ? entries : [];
}

/** The browsable toolkit catalog (usage-ranked), for the Connectors UI. */
export async function listComposioToolkits(
	logger?: BasicLogger,
): Promise<ComposioCatalogResponse> {
	const scope = getAccountScope();
	if (!scope) {
		return { configured: false, toolkits: [] };
	}
	const ctx: ClineAuthTelemetryContext = { logger };
	if (!(await isConnectorsAvailable(scope, { ctx }))) {
		return { configured: false, toolkits: [] };
	}
	try {
		const toolkits = await ensureToolkitCatalog(scope, ctx);
		if (getClineAccountId() !== scope.accountId) {
			return { configured: false, toolkits: [] };
		}
		return {
			configured: true,
			toolkits,
		};
	} catch (error) {
		throw new Error(
			`Could not load the Composio connector catalog: ${formatConnectorsError(error)}`,
		);
	}
}

// ── Connect / disconnect ─────────────────────────────────────────────────

export async function connectComposioToolkit(
	toolkit: ComposioToolkitSlug,
	logger?: BasicLogger,
	options?: { owner?: object },
): Promise<ComposioConnectResponse> {
	const scope = getAccountScope();
	if (!scope) {
		throw new Error("Sign in to your Cline account to use connectors.");
	}
	// Record intent before any await. A later disconnect/cancel receives a
	// larger sequence and wins; a later reconnect receives a larger sequence
	// of its own and survives, regardless of wall-clock resolution or changes.
	const startedSequence = ++scope.operationSequence;
	const ctx: ClineAuthTelemetryContext = { logger };
	if (!(await isConnectorsAvailable(scope, { ctx }))) {
		throw new Error(
			"Sign in to your Cline account to use connectors. If you are signed in, connectors may not be enabled for your account yet.",
		);
	}
	const existingPending = scope.pendingConnections.get(toolkit);
	if (existingPending) {
		return {
			redirectUrl: existingPending.redirectUrl,
			status: buildStatusResponse(scope, readComposioState(scope), true),
		};
	}
	if (scope.connectInitiationsInFlight.has(toolkit)) {
		// Another connect for this toolkit is mid-initiation (see the set's
		// doc). Single-flight: the first call owns the attempt and already
		// received its redirect; this one just reports current status.
		return {
			status: buildStatusResponse(scope, readComposioState(scope), true),
		};
	}
	scope.connectInitiationsInFlight.add(toolkit);
	try {
		scope.lastConnectionErrors.delete(toolkit);
		let initiated: Awaited<ReturnType<typeof initiateConnection>>;
		try {
			initiated = await initiateConnection(toolkit, {
				...ctx,
				accountId: scope.accountId,
			});
		} catch (error) {
			throw new Error(
				`Could not start the ${toolkit} connection: ${formatConnectorsError(error)}`,
			);
		}
		const redirectUrl = initiated.redirectUrl?.trim() || undefined;
		const connectedAccountId = initiated.connectedAccountId;
		if (getClineAccountId() !== scope.accountId) {
			await abandonFinalizedConnection(scope, connectedAccountId, ctx);
			return { status: { configured: false, integrations: [] } };
		}
		const guard: FinalizeGuard = { startedSequence };
		if (!redirectUrl) {
			// No browser step needed (the account is already authorized on
			// Composio's side) — finalize right away. There is no pending entry
			// on this path, so the disconnect defense lives entirely in the
			// guard's startedSequence check inside finalizeToolkitConnection.
			let persisted: boolean;
			try {
				persisted = await finalizeToolkitConnection(
					scope,
					toolkit,
					connectedAccountId,
					guard,
					ctx,
				);
			} catch (error) {
				// The attempt failed from the app's point of view, but the freshly
				// created account is authorized on Composio's side and nothing
				// references it — abandon it like a cancel before surfacing.
				await abandonFinalizedConnection(scope, connectedAccountId, ctx);
				throw error;
			}
			return {
				...(persisted ? { alreadyConnected: true } : {}),
				status: buildStatusResponse(scope, readComposioState(scope), true),
			};
		}

		const attemptId = randomUUID();
		scope.pendingConnections.set(toolkit, {
			attemptId,
			connectedAccountId,
			redirectUrl,
			startedSequence,
			owner: options?.owner,
		});

		// The OAuth flow finishes in the external browser, which cannot navigate
		// the app back. Poll the proxy for the connection in the background; the
		// webview polls `status` to observe the flip.
		void (async () => {
			try {
				await waitForConnectionActive(connectedAccountId, {
					timeoutMs: CONNECT_WAIT_TIMEOUT_MS,
					shouldContinue: () =>
						scope.pendingConnections.get(toolkit)?.attemptId === attemptId,
					logger,
					ctx: { ...ctx, accountId: scope.accountId },
				});
				if (scope.pendingConnections.get(toolkit)?.attemptId !== attemptId) {
					return; // Cancelled or superseded while we waited.
				}
				// finalizeToolkitConnection re-checks the attempt at write time,
				// so a cancel or disconnect that lands during the tool fetch
				// cannot be overwritten by this attempt.
				await finalizeToolkitConnection(
					scope,
					toolkit,
					connectedAccountId,
					{
						...guard,
						attemptId,
					},
					ctx,
				);
			} catch (error) {
				if (scope.pendingConnections.get(toolkit)?.attemptId !== attemptId) {
					return; // Cancel/disconnect already abandoned it.
				}
				const reason = formatConnectorsError(error);
				scope.lastConnectionErrors.set(
					toolkit,
					`Connection was not completed: ${reason}`,
				);
				logger?.log?.(`composio connect ${toolkit} failed: ${reason}`);
				// The attempt is dead from the app's point of view (timeout, wait
				// error, or a failed finalize), but the browser flow can still turn
				// the remote account ACTIVE later — where reconciliation would
				// import it, materializing a connection the user was told failed.
				// Abandon it like a cancel: tombstone first, revoke best-effort.
				await abandonFinalizedConnection(scope, connectedAccountId, ctx);
			} finally {
				if (scope.pendingConnections.get(toolkit)?.attemptId === attemptId) {
					scope.pendingConnections.delete(toolkit);
				}
			}
		})();

		return {
			redirectUrl,
			status: buildStatusResponse(scope, readComposioState(scope), true),
		};
	} finally {
		scope.connectInitiationsInFlight.delete(toolkit);
	}
}

async function cancelAccountConnect(
	scope: AccountScope,
	toolkit: ComposioToolkitSlug,
	logger?: BasicLogger,
): Promise<void> {
	const pending = scope.pendingConnections.get(toolkit);
	scope.pendingConnections.delete(toolkit);
	if (!pending) {
		return;
	}
	// Record the cancel intent BEFORE any await, so a status refresh that
	// snapshotted this account as ACTIVE and is mid-import drops it at its
	// write-time check (scope.lastDisconnectSequence >= refreshSequence). The tombstone
	// alone is not enough for that: a successful revocation prunes it before
	// the refresh's write, so the sequence is the durable "cancelled during
	// this refresh" signal. Mirrors the disconnect entry marker.
	scope.lastDisconnectSequence.set(toolkit, ++scope.operationSequence);
	// Deleting the local marker alone is not enough: the OAuth tab may still
	// be open, and completing it later would turn the remote account ACTIVE,
	// where the next dashboard reconciliation would import it right back.
	// Tombstone the attempt first (persisted, so a sidecar restart cannot
	// forget it), then revoke the account remotely. If the revocation fails,
	// the account can linger on Composio's side until a later status refresh
	// retries the delete — the tombstone keeps it from ever materializing
	// tools here, and is only pruned once the delete is confirmed.
	updateComposioState(scope, (state) => {
		rememberCancelledAccountId(state, pending.connectedAccountId);
	});
	const confirmedGone = await revokeConnectedAccountQuietly(
		scope,
		pending.connectedAccountId,
		{ logger },
	);
	if (confirmedGone) {
		pruneConfirmedCancelledAccount(scope, pending.connectedAccountId);
	}
}

/**
 * Abandon every pending OAuth attempt started by `owner` — the webview
 * connection that initiated it. Called when that connection goes away
 * (webview closed/reloaded, transport drop), mirroring how provider and MCP
 * OAuth waits are cancelled for a departing owner: an interactive attempt the
 * user walked away from must not complete in the background and materialize
 * credential-bearing tools afterward. Each is abandoned exactly like an
 * explicit cancel (tombstone + best-effort revoke). Returns the count
 * abandoned.
 */
export function abandonComposioConnectsForOwner(
	owner: object,
	logger?: BasicLogger,
): number {
	let abandoned = 0;
	for (const scope of accountScopes.values()) {
		for (const [toolkit, pending] of scope.pendingConnections) {
			if (pending.owner === owner) {
				void cancelAccountConnect(scope, toolkit, logger);
				abandoned++;
			}
		}
	}
	return abandoned;
}

/**
 * Whether a remote deletion failed because the account is ALREADY gone
 * (revoked from the Composio dashboard, or an attempt that never completed) —
 * the only failure that may be treated as a successful revocation. The proxy
 * surfaces this as an HTTP 404 through {@link ConnectorsApiError.status}.
 * Anything else fails CLOSED: the revocation counts as unconfirmed, local
 * state is kept, and reconciliation retries.
 */
function isAccountAlreadyGoneError(error: unknown): boolean {
	return error instanceof ConnectorsApiError && error.status === 404;
}

export async function disconnectComposioToolkit(
	toolkit: ComposioToolkitSlug,
	logger?: BasicLogger,
): Promise<ComposioStatusResponse> {
	const scope = getAccountScope();
	if (!scope) {
		return { configured: false, integrations: [] };
	}
	// Record the disconnect intent BEFORE any await, so a connect attempt
	// that began earlier and finalizes while this disconnect is still
	// awaiting its remote revocation is dropped at write time (its startedSequence
	// predates this marker; see FinalizeGuard.startedSequence). Whichever action
	// started later wins, symmetrically.
	scope.lastDisconnectSequence.set(toolkit, ++scope.operationSequence);
	const ctx: ClineAuthTelemetryContext = { logger };
	const pending = scope.pendingConnections.get(toolkit);
	scope.pendingConnections.delete(toolkit);
	scope.lastConnectionErrors.delete(toolkit);
	// Snapshot for decisions only — every persisted change below goes through
	// updateComposioState so a concurrent writer is never clobbered.
	const state = readReconciledComposioState(scope, logger);
	if (pending) {
		// A still-open browser flow for this toolkit could complete after the
		// disconnect; treat the attempt exactly like an explicit cancel.
		updateComposioState(scope, (s) => {
			rememberCancelledAccountId(s, pending.connectedAccountId);
		});
		const confirmedGone = await revokeConnectedAccountQuietly(
			scope,
			pending.connectedAccountId,
			ctx,
		);
		if (confirmedGone) {
			pruneConfirmedCancelledAccount(scope, pending.connectedAccountId);
		}
	}
	const stored = state.toolkits?.[toolkit];
	if (stored) {
		try {
			await deleteConnection(stored.connectedAccountId, {
				...ctx,
				accountId: scope.accountId,
			});
		} catch (error) {
			if (!isAccountAlreadyGoneError(error)) {
				const current =
					readComposioState(scope).toolkits?.[toolkit]?.connectedAccountId;
				if (
					current === stored.connectedAccountId &&
					!scope.connectInitiationsInFlight.has(toolkit)
				) {
					// Revocation did NOT happen: the account is still authorized
					// on Composio's side, and running Hub sessions that loaded
					// this connector keep executing against it until the delete
					// lands. Removing only the local state would report an
					// uninstall that never took effect remotely — keep the
					// connector installed (it is the retry vehicle) and surface
					// the failure.
					throw new Error(
						`Could not revoke the ${toolkit} connection: ${formatConnectorsError(error)}. The connector is still connected — try again, or revoke it from the Composio dashboard.`,
					);
				}
				// The slot was replaced by a newer connect (or one is mid-flight
				// and may replace it), so the stored entry can no longer serve
				// as the retry vehicle for this still-authorized account —
				// throwing here would orphan it with no local reference at all.
				// Tombstone it instead: reconciliation retries the revocation on
				// every refresh and prunes once it is confirmed.
				updateComposioState(scope, (s) => {
					rememberCancelledAccountId(s, stored.connectedAccountId);
				});
				logger?.log?.(
					`composio disconnect ${toolkit}: revocation failed after the slot changed; retrying via tombstone (${formatConnectorsError(error)})`,
				);
			} else {
				// Already deleted on Composio's side; local removal is all that
				// is left to do.
				logger?.log?.(
					`composio disconnect ${toolkit}: account already gone remotely`,
				);
			}
		}
	}
	const next = updateComposioState(scope, (s) => {
		const current = s.toolkits?.[toolkit];
		// Remove only the account this disconnect actually revoked. A
		// connection finalized while the awaited revocation above was in
		// flight is the newer user intent (its startedSequence is after this
		// disconnect's entry marker, so finalize was NOT dropped): it carries
		// a different account id and its remote account was never touched —
		// blindly deleting it here would leave that account authorized with no
		// local record, for the next refresh to import as a resurrected
		// connector.
		if (
			current &&
			stored &&
			current.connectedAccountId === stored.connectedAccountId &&
			s.toolkits
		) {
			delete s.toolkits[toolkit];
		}
	});
	return buildStatusResponse(scope, next, true);
}

// ── Tool materialization ─────────────────────────────────────────────────

async function fetchToolkitTools(
	scope: AccountScope,
	toolkit: ComposioToolkitSlug,
	ctx: ClineAuthTelemetryContext,
): Promise<StoredComposioTool[]> {
	const rawTools = await listToolkitTools(toolkit, {
		...ctx,
		accountId: scope.accountId,
	});
	const tools: StoredComposioTool[] = [];
	for (const raw of rawTools) {
		const tool = toStoredTool(raw);
		if (tool) {
			tools.push(tool);
		}
	}
	return tools;
}

type FinalizeGuard = {
	/** Present for browser-flow attempts; the pending entry must still carry
	 * this id at write time (cancel/disconnect clear it). */
	attemptId?: string;
	/** Sequence at connection entry. A later disconnect is the newer user
	 * intent: the result is dropped and its account revoked instead of written.
	 * This is
	 * the only disconnect defense on the redirect-less path, which never has
	 * a pending entry for the disconnect to clear. */
	startedSequence: number;
};

/** An attempt whose result must not be persisted — superseded by a
 * disconnect, or failed from the app's point of view (wait timeout/error,
 * failed finalize) — can still leave an authorized account behind on
 * Composio's side that nothing references, and its browser flow may even
 * complete later. Tombstone it so reconciliation can never import it, then
 * revoke it — the same lifecycle as a cancelled attempt. */
async function abandonFinalizedConnection(
	scope: AccountScope,
	connectedAccountId: string,
	ctx: ClineAuthTelemetryContext,
): Promise<void> {
	updateComposioState(scope, (s) => {
		rememberCancelledAccountId(s, connectedAccountId);
		// A concurrent refresh may have imported this account before the
		// tombstone above landed (it was ACTIVE remotely while the attempt was
		// still finalizing). No stored entry may outlive its abandoned
		// account, so strip any toolkit that carries it.
		for (const [slug, stored] of Object.entries(s.toolkits ?? {})) {
			if (stored?.connectedAccountId === connectedAccountId && s.toolkits) {
				delete s.toolkits[slug];
			}
		}
	});
	const confirmedGone = await revokeConnectedAccountQuietly(
		scope,
		connectedAccountId,
		ctx,
	);
	if (confirmedGone) {
		pruneConfirmedCancelledAccount(scope, connectedAccountId);
	}
}

/** Returns whether the connection was actually persisted — a dropped result
 * (superseded attempt or a disconnect that won the race) must not be
 * reported as a successful connect by callers. */
async function finalizeToolkitConnection(
	scope: AccountScope,
	toolkit: ComposioToolkitSlug,
	connectedAccountId: string,
	guard: FinalizeGuard,
	ctx: ClineAuthTelemetryContext,
): Promise<boolean> {
	const tools = await fetchToolkitTools(scope, toolkit, ctx);
	if (getClineAccountId() !== scope.accountId) {
		await abandonFinalizedConnection(scope, connectedAccountId, ctx);
		return false;
	}
	// Everything below (up to the state write) runs synchronously, so these
	// write-time checks cannot be raced by a cancel or disconnect that
	// happened while the tool fetch (or the browser flow) was in flight.
	if (
		guard.attemptId &&
		scope.pendingConnections.get(toolkit)?.attemptId !== guard.attemptId
	) {
		// Whoever cleared the attempt (cancel, disconnect) already tombstoned
		// and revoked its account.
		ctx.logger?.log?.(
			`composio connect ${toolkit}: attempt superseded before finalize; dropping result`,
		);
		return false;
	}
	if (
		(scope.lastDisconnectSequence.get(toolkit) ?? 0) >= guard.startedSequence
	) {
		// The user disconnected this toolkit after the attempt began; writing
		// the result now would resurrect the connector they removed.
		ctx.logger?.log?.(
			`composio connect ${toolkit}: disconnected mid-finalize; dropping and revoking the new account`,
		);
		await abandonFinalizedConnection(scope, connectedAccountId, ctx);
		return false;
	}
	// No await separates the guard checks above from this write, so the
	// checked state cannot go stale in between.
	let replacedAccountId: string | undefined;
	updateComposioState(scope, (s) => {
		const previous = s.toolkits?.[toolkit];
		if (previous && previous.connectedAccountId !== connectedAccountId) {
			// Superseded by this connection: nothing references the previous
			// account anymore, so it must not stay authorized remotely.
			replacedAccountId = previous.connectedAccountId;
			rememberCancelledAccountId(s, previous.connectedAccountId);
		}
		s.toolkits = {
			...(s.toolkits ?? {}),
			[toolkit]: {
				connectedAccountId,
				connectedAt: new Date().toISOString(),
				...lookupCatalogDisplayInfo(scope, toolkit),
				tools,
			},
		};
	});
	if (replacedAccountId) {
		const superseded = replacedAccountId;
		void revokeConnectedAccountQuietly(scope, superseded, ctx).then(
			(confirmedGone) => {
				if (confirmedGone) {
					pruneConfirmedCancelledAccount(scope, superseded);
				}
			},
		);
	}
	ctx.logger?.log?.(
		`composio connected ${toolkit} with ${tools.length} tool(s)`,
	);
	return true;
}

export async function cancelComposioConnect(
	toolkit: ComposioToolkitSlug,
	logger?: BasicLogger,
): Promise<void> {
	const scope = getAccountScope();
	if (scope) await cancelAccountConnect(scope, toolkit, logger);
}
