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
 * directly. Instead, connection state plus the fetched tool schemas are
 * persisted to `<cline-data>/settings/composio.json`, which core's built-in
 * `composio-tools` extension (`@cline/core`, composio-tools-extension.ts)
 * reads at session start to register one tool per connected Composio tool.
 * New sessions pick state changes up automatically; running sessions keep
 * their frozen tool set.
 */

const COMPOSIO_STATE_FILE_NAME = "composio.json";
/** Where pre–in-process-registration builds materialized a drop-in plugin;
 * kept only so those legacy files can be cleaned up. */
const LEGACY_COMPOSIO_PLUGIN_RELATIVE_PATH = ["plugins", "composio-tools.ts"];
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
	/**
	 * Copy of the managed COMPOSIO_API_KEY environment variable, persisted so
	 * core's composio-tools extension — which runs in the Hub process without
	 * this process's environment — can execute tools. Re-synced on every
	 * read: rotated when the managed key changes, dropped when it disappears.
	 * There is no user-entered key.
	 */
	apiKey?: string;
	/** Stable per-install Composio user id; generated on first configuration. */
	userId?: string;
	toolkits?: Partial<Record<string, StoredComposioToolkit>>;
	/**
	 * Connected-account ids from OAuth attempts the user cancelled (or that a
	 * disconnect / key change abandoned) while the browser flow could still
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
	startedAt: number;
	/** The key/user the attempt was started under; finalization is dropped if
	 * either changed while the browser flow was in flight. */
	apiKey: string;
	userId: string;
};

type ComposioConnectionRequest = {
	id: string;
	redirectUrl?: string | null;
	waitForConnection: (timeout?: number) => Promise<unknown>;
};

/** One toolkit from the raw catalog endpoint (`GET /api/v3/toolkits`). The
 * SDK's wrapper strips the auth-availability fields we filter on, so the
 * catalog is fetched over REST directly. */
type RawComposioToolkitItem = {
	slug: string;
	name: string;
	meta?: {
		description?: string;
		logo?: string;
		tools_count?: number;
		categories?: Array<{ slug: string; name: string }>;
	};
	/** Auth methods Composio manages credentials for; empty/absent means the
	 * org must bring its own auth config for this toolkit. */
	composio_managed_auth_schemes?: string[];
	no_auth?: boolean;
};

/** Minimal surface of the `@composio/core` client this module uses; the SDK is
 * loaded lazily so sidecar startup does not pay its import cost. */
type ComposioClient = {
	toolkits: {
		authorize: (
			userId: string,
			toolkitSlug: string,
		) => Promise<ComposioConnectionRequest>;
	};
	authConfigs: {
		list: (query?: { toolkit?: string }) => Promise<{
			items: Array<{
				id: string;
				isComposioManaged?: boolean;
				toolkit?: { slug: string };
			}>;
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
		list: (query?: {
			userIds?: string[];
			toolkitSlugs?: string[];
			cursor?: string;
		}) => Promise<{
			items: Array<{
				id: string;
				status: string;
				isDisabled?: boolean;
				toolkit: { slug: string };
			}>;
			nextCursor?: string | null;
		}>;
		link: (
			userId: string,
			authConfigId: string,
		) => Promise<ComposioConnectionRequest>;
	};
	/**
	 * The underlying REST client. Account deletions go through it because the
	 * high-level wrapper's `connectedAccounts.delete` never sends
	 * `revoke_on_delete` and the API defaults it to false — a soft delete
	 * that removes the Composio record while leaving the upstream OAuth grant
	 * (the Gmail/Calendar/GitHub token itself) authorized.
	 */
	getClient: () => {
		connectedAccounts: {
			delete: (
				id: string,
				params: { revoke_on_delete: boolean },
			) => Promise<unknown>;
		};
	};
};

type ConnectedAccountListItem = {
	id: string;
	status: string;
	isDisabled?: boolean;
	toolkit: { slug: string };
};

const pendingConnections = new Map<ComposioToolkitSlug, PendingConnection>();
/**
 * Toolkits whose connect call is inside its initiation round trip. The
 * pending entry only exists once Composio has returned the connected-account
 * id, so this set is what makes connects single-flight across that window —
 * without it, two overlapping calls would each create a remote account and
 * the second `pendingConnections.set` would overwrite the first, leaving the
 * superseded account unrevoked and eligible for a later import.
 */
const connectInitiationsInFlight = new Set<ComposioToolkitSlug>();
const lastConnectionErrors = new Map<ComposioToolkitSlug, string>();
/** When each toolkit was last disconnected, so state snapshots taken before
 * the disconnect cannot write it back. */
const lastDisconnectedAt = new Map<ComposioToolkitSlug, number>();

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
	mutate: (state: StoredComposioState) => void,
): StoredComposioState {
	const state = readComposioState();
	mutate(state);
	writeComposioState(state);
	return state;
}

/**
 * The managed Composio API key: the COMPOSIO_API_KEY environment variable
 * exported to the sidecar process. There is no user-entered key, and the key
 * is deliberately NOT baked into shipped binaries — a client-embedded secret
 * is extractable by anyone with the artifact. Installs without the variable
 * keep connectors hidden; the intended interim rollout is internal users
 * exporting the key locally, until a Cline-platform proxy holds it
 * server-side.
 */
function resolveManagedComposioApiKey(): string | undefined {
	return process.env.COMPOSIO_API_KEY?.trim() || undefined;
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
function pruneConfirmedCancelledAccount(accountId: string): void {
	updateComposioState((state) => {
		forgetCancelledAccountId(state, accountId);
	});
}

/**
 * Best-effort remote revocation for cancelled/abandoned OAuth attempts.
 * Returns true when the account is confirmed gone (deleted now, or already
 * deleted) — the caller then prunes its tombstone. A failure is logged, not
 * thrown: the persisted tombstone keeps the account from ever materializing
 * tools locally, and the status-refresh reconciliation retries the deletion
 * whenever Composio still reports the account.
 */
async function revokeConnectedAccountQuietly(
	apiKey: string,
	accountId: string,
	logger?: BasicLogger,
): Promise<boolean> {
	try {
		const client = await getComposioClient(apiKey);
		await deleteConnectedAccountWithRevocation(client, accountId);
		return true;
	} catch (error) {
		if (isAccountAlreadyGoneError(error)) {
			return true;
		}
		logger?.log?.(
			`composio: revoking cancelled account ${accountId} failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/**
 * Deletes a connected account AND revokes its upstream OAuth credentials.
 * Without `revoke_on_delete=true` the API only soft-deletes the Composio
 * record: tool execution stops, but the provider-side grant (the actual
 * Gmail/Calendar/GitHub token) stays authorized — a disconnect the UI
 * reports as done would leave live credentials behind. The high-level SDK
 * wrapper never sends the flag, so this goes through the raw client.
 */
async function deleteConnectedAccountWithRevocation(
	client: ComposioClient,
	accountId: string,
): Promise<unknown> {
	return await client.getClient().connectedAccounts.delete(accountId, {
		revoke_on_delete: true,
	});
}

/** Defensive cap; a user has roughly one connected account per toolkit, so
 * real lists fit in one or two pages. */
const CONNECTED_ACCOUNTS_MAX_PAGES = 20;

/**
 * Lists the user's connected accounts following pagination to the end. The
 * reconciliation removal logic treats absence from this list as "revoked
 * remotely", so a truncated listing would locally disconnect accounts that
 * merely live on a later page. `complete` is false only when the page cap
 * was hit — callers must then skip absence-based removals.
 */
async function listAllConnectedAccounts(
	client: ComposioClient,
	userId: string,
): Promise<{ items: ConnectedAccountListItem[]; complete: boolean }> {
	const items: ConnectedAccountListItem[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < CONNECTED_ACCOUNTS_MAX_PAGES; page++) {
		const response = await client.connectedAccounts.list({
			userIds: [userId],
			...(cursor ? { cursor } : {}),
		});
		items.push(...(response.items ?? []));
		const nextCursor = response.nextCursor ?? undefined;
		if (!nextCursor) {
			return { items, complete: true };
		}
		cursor = nextCursor;
	}
	return { items, complete: false };
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
	state: StoredComposioState,
	logger?: BasicLogger,
): void {
	for (const pending of pendingConnections.values()) {
		rememberCancelledAccountId(state, pending.connectedAccountId);
		void revokeConnectedAccountQuietly(
			pending.apiKey,
			pending.connectedAccountId,
			logger,
		).then((confirmedGone) => {
			if (confirmedGone) {
				pruneConfirmedCancelledAccount(pending.connectedAccountId);
			}
		});
	}
	pendingConnections.clear();
}

/**
 * Keep the stored key in sync with the managed COMPOSIO_API_KEY: adopt it
 * when none is stored, rotate the stored copy when it changes, and drop it
 * when it disappears.
 *
 * Any change to the effective key also drops the connected toolkits and
 * abandons in-flight OAuth attempts: both belong to the previous key's
 * Composio project, and keeping the toolkits would report old-project
 * connectors as installed while new sessions execute their tools under the
 * new key (failed calls, or an unintended matching account). Accounts that
 * exist under the new key's project are re-imported by the next status
 * refresh.
 *
 * Persists (and re-syncs the plugin file) only when something changed.
 */
function reconcileManagedApiKey(
	state: StoredComposioState,
	logger?: BasicLogger,
): void {
	const managedKey = resolveManagedComposioApiKey();
	if ((state.apiKey || undefined) === managedKey) {
		return;
	}
	abandonPendingConnections(state, logger);
	state.toolkits = {};
	if (managedKey) {
		state.apiKey = managedKey;
		if (!state.userId) {
			state.userId = `cline-desktop-${randomUUID()}`;
		}
	} else {
		delete state.apiKey;
	}
	lastConnectionErrors.clear();
	catalogCache = null;
	writeComposioState(state);
	logger?.log?.(
		managedKey
			? "composio: managed api key adopted; connections will re-import from Composio on refresh"
			: "composio: managed api key is gone; dropped the key and materialized connections",
	);
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
	logger?: BasicLogger,
): StoredComposioState {
	removeLegacyComposioPluginQuietly(logger);
	const state = readComposioState();
	reconcileManagedApiKey(state, logger);
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
	// A connected toolkit with zero materialized tools is a wedge, not a
	// healthy state (sessions get nothing) — surface it instead of letting
	// the card look fine. Reconciliation re-fetches the schemas on the next
	// status refresh (see the self-heal arm in getComposioStatus).
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
		error: lastConnectionErrors.get(slug) ?? zeroToolsWarning,
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
		const refreshStartedAt = Date.now();
		const client = await getComposioClient(state.apiKey);
		const accounts = await listAllConnectedAccounts(client, state.userId);
		const cancelledIds = new Set(state.cancelledAccountIds ?? []);
		const activeByToolkit = new Map<string, string>();
		for (const account of accounts.items ?? []) {
			if (cancelledIds.has(account.id)) {
				// A cancelled attempt Composio still knows about — its browser
				// flow may have completed after the cancel. Retry the revocation
				// instead of importing it; once the delete is confirmed the
				// tombstone has nothing left to guard and is pruned.
				const confirmedGone = await revokeConnectedAccountQuietly(
					state.apiKey,
					account.id,
					options?.logger,
				);
				if (confirmedGone) {
					pruneConfirmedCancelledAccount(account.id);
				}
				continue;
			}
			if (account.status === "ACTIVE" && !account.isDisabled) {
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
				// Absence-based removal is only sound when the whole account
				// list was seen; a capped (incomplete) listing proves nothing
				// about accounts past the cap.
				if (accounts.complete) {
					removals.push(slug);
				}
			} else if (
				remoteAccountId &&
				(!stored ||
					stored.connectedAccountId !== remoteAccountId ||
					// Self-heal: a toolkit persisted with zero tools (the schema
					// fetch returned empty at connect time — a transient Composio
					// hiccup, or state written by an older build) would otherwise
					// stay wedged forever: reported as connected while sessions
					// get no tools, with nothing ever re-fetching. Re-fetch
					// instead of trusting the empty cache.
					stored.tools.length === 0) &&
				!pendingConnections.has(slug) &&
				// A connect mid-initiation owns the slug (its pending entry does
				// not exist yet): a redirect-less attempt can already be ACTIVE
				// remotely while its finalize is still fetching tools, and
				// importing it here would keep it installed even if that
				// finalize then fails and abandons the account.
				!connectInitiationsInFlight.has(slug) &&
				// The remote snapshot predates a local disconnect of this
				// toolkit; writing it back would resurrect the connection.
				(lastDisconnectedAt.get(slug) ?? 0) < refreshStartedAt
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
					...lookupCatalogDisplayInfo(slug),
					...(sameAccount && stored?.name ? { name: stored.name } : {}),
					...(sameAccount && stored?.logo ? { logo: stored.logo } : {}),
					tools: await fetchToolkitTools(client, slug),
				});
			}
		}
		if (removals.length > 0 || imports.size > 0) {
			// The tool fetches above are slow enough for a connect, disconnect,
			// cancel, or key change to have landed meanwhile. Each delta is
			// applied to the freshly read state only if that slug still matches
			// the baseline it was decided against (per-slug compare-and-swap),
			// so concurrent changes survive this write.
			const next = updateComposioState((fresh) => {
				if (fresh.apiKey !== state.apiKey || fresh.userId !== state.userId) {
					return; // Key changed mid-refresh; keep the fresh state as-is.
				}
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
					if ((lastDisconnectedAt.get(slug) ?? 0) >= refreshStartedAt) {
						continue; // Disconnected mid-refresh.
					}
					if (
						pendingConnections.has(slug) ||
						connectInitiationsInFlight.has(slug)
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
			return buildStatusResponse(next);
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

const COMPOSIO_BASE_URL = (
	process.env.COMPOSIO_BASE_URL || "https://backend.composio.dev"
).replace(/\/+$/, "");

/** The SDK's catalog wrapper strips `composio_managed_auth_schemes`, which
 * the connectable filter needs, so fetch the same endpoint over REST. */
async function fetchRawToolkitCatalog(
	apiKey: string,
): Promise<RawComposioToolkitItem[]> {
	const url = new URL(`${COMPOSIO_BASE_URL}/api/v3/toolkits`);
	url.searchParams.set("sort_by", "usage");
	url.searchParams.set("limit", String(CATALOG_FETCH_LIMIT));
	const response = await fetch(url, { headers: { "x-api-key": apiKey } });
	if (!response.ok) {
		throw new Error(`toolkit catalog request failed (HTTP ${response.status})`);
	}
	const parsed = (await response.json()) as {
		items?: RawComposioToolkitItem[];
	};
	return parsed.items ?? [];
}

async function listConfiguredToolkitSlugs(
	client: ComposioClient,
): Promise<Set<string>> {
	const configured = new Set<string>();
	try {
		const response = await client.authConfigs.list();
		for (const item of response.items ?? []) {
			const slug = item.toolkit?.slug?.trim().toLowerCase();
			if (slug) {
				configured.add(slug);
			}
		}
	} catch {
		// Best-effort: without the list, only managed toolkits are shown.
	}
	return configured;
}

/**
 * Maps the raw catalog onto browsable entries, keeping only toolkits a
 * Connect click can actually finish: Composio manages credentials for them,
 * or the project already has an auth config (e.g. the org's own OAuth app).
 * Exported for tests.
 */
export function buildConnectableCatalog(
	items: RawComposioToolkitItem[],
	configuredSlugs: ReadonlySet<string>,
): ComposioCatalogToolkit[] {
	const seen = new Set<string>();
	const entries: ComposioCatalogToolkit[] = [];
	for (const item of items ?? []) {
		const slug = item?.slug?.trim().toLowerCase();
		if (!slug || seen.has(slug) || !isComposioToolkitSlug(slug)) {
			continue;
		}
		seen.add(slug);
		const managed = (item.composio_managed_auth_schemes?.length ?? 0) > 0;
		if (!managed && !configuredSlugs.has(slug)) {
			continue;
		}
		entries.push({
			slug,
			name: item.name?.trim() || slug,
			description: item.meta?.description?.trim() || undefined,
			logo: item.meta?.logo || undefined,
			categories: item.meta?.categories
				?.map((category) => category.name)
				.filter(Boolean),
			toolsCount: item.meta?.tools_count,
			recommended: Boolean(findRecommendedToolkit(slug)),
		});
	}
	return entries;
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
	const [items, configuredSlugs] = await Promise.all([
		fetchRawToolkitCatalog(apiKey),
		listConfiguredToolkitSlugs(client),
	]);
	const entries = buildConnectableCatalog(items, configuredSlugs);
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

// ── Connect / disconnect ─────────────────────────────────────────────────

export async function connectComposioToolkit(
	toolkit: ComposioToolkitSlug,
	logger?: BasicLogger,
): Promise<ComposioConnectResponse> {
	// Anchor the disconnect race at function entry, BEFORE any await: a
	// disconnect whose marker lands at or after this instant overlapped this
	// attempt somewhere (including during the connection-initiation round
	// trip) and must win at finalize time (see FinalizeGuard.startedAt).
	// Disconnect sets its marker after its awaited remote deletion, i.e. at
	// the latest point of its execution, so every overlapping interleaving
	// yields marker >= startedAt.
	const startedAt = Date.now();
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
	if (connectInitiationsInFlight.has(toolkit)) {
		// Another connect for this toolkit is mid-initiation (see the set's
		// doc). Single-flight: the first call owns the attempt and already
		// received its redirect; this one just reports current status.
		return { status: buildStatusResponse(state) };
	}
	connectInitiationsInFlight.add(toolkit);
	try {
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
		const guard = { apiKey: state.apiKey, userId: state.userId, startedAt };
		if (!redirectUrl) {
			// No browser step needed (e.g. the account is already authorized on
			// Composio's side) — finalize right away. There is no pending entry on
			// this path, so the disconnect defense lives entirely in the guard's
			// startedAt check inside finalizeToolkitConnection.
			let persisted: boolean;
			try {
				persisted = await finalizeToolkitConnection(
					client,
					toolkit,
					connectionRequest.id,
					guard,
					logger,
				);
			} catch (error) {
				// The attempt failed from the app's point of view, but the freshly
				// created account is authorized on Composio's side and nothing
				// references it — left alone, the next reconciliation would import
				// it and a connection the user was told failed would silently
				// appear as installed. Abandon it like a cancel before surfacing
				// the error.
				await abandonFinalizedConnection(
					connectionRequest.id,
					guard.apiKey,
					logger,
				);
				throw error;
			}
			// A dropped result (a disconnect won the race, or the key changed
			// mid-flow) must not report success: the connector is NOT connected,
			// and the status below already reflects that.
			return {
				...(persisted ? { alreadyConnected: true } : {}),
				status: buildStatusResponse(readComposioState()),
			};
		}

		const attemptId = randomUUID();
		pendingConnections.set(toolkit, {
			attemptId,
			connectedAccountId: connectionRequest.id,
			redirectUrl,
			...guard,
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
				// finalizeToolkitConnection re-checks the attempt and the key/user
				// at write time, so a cancel, disconnect, or key change that lands
				// during the tool fetch cannot be overwritten by this attempt.
				await finalizeToolkitConnection(
					client,
					toolkit,
					connectionRequest.id,
					{ ...guard, attemptId },
					logger,
				);
			} catch (error) {
				if (pendingConnections.get(toolkit)?.attemptId !== attemptId) {
					return; // Cancel/disconnect/key change already abandoned it.
				}
				const reason = formatComposioError(error);
				lastConnectionErrors.set(
					toolkit,
					`Connection was not completed: ${reason}`,
				);
				logger?.log?.(`composio connect ${toolkit} failed: ${reason}`);
				// The attempt is dead from the app's point of view (timeout, wait
				// error, or a failed finalize), but the browser flow can still turn
				// the remote account ACTIVE later — where reconciliation would
				// import it, materializing a connection the user was told failed.
				// Abandon it like a cancel: tombstone first, revoke best-effort.
				await abandonFinalizedConnection(
					connectionRequest.id,
					guard.apiKey,
					logger,
				);
			} finally {
				if (pendingConnections.get(toolkit)?.attemptId === attemptId) {
					pendingConnections.delete(toolkit);
				}
			}
		})();

		return { redirectUrl, status: buildStatusResponse(state) };
	} finally {
		connectInitiationsInFlight.delete(toolkit);
	}
}

export async function cancelComposioConnect(
	toolkit: ComposioToolkitSlug,
	logger?: BasicLogger,
): Promise<void> {
	const pending = pendingConnections.get(toolkit);
	pendingConnections.delete(toolkit);
	if (!pending) {
		return;
	}
	// Deleting the local marker alone is not enough: the OAuth tab may still
	// be open, and completing it later would turn the remote account ACTIVE,
	// where the next dashboard reconciliation would import it right back.
	// Tombstone the attempt first (persisted, so a sidecar restart cannot
	// forget it), then revoke the account remotely. If the revocation fails,
	// the account can linger on Composio's side until a later status refresh
	// retries the delete — the tombstone keeps it from ever materializing
	// tools here, and is only pruned once the delete is confirmed.
	updateComposioState((state) => {
		rememberCancelledAccountId(state, pending.connectedAccountId);
	});
	const confirmedGone = await revokeConnectedAccountQuietly(
		pending.apiKey,
		pending.connectedAccountId,
		logger,
	);
	if (confirmedGone) {
		pruneConfirmedCancelledAccount(pending.connectedAccountId);
	}
}

/**
 * Whether a remote deletion failed because the account is ALREADY gone
 * (revoked from the Composio dashboard, or an attempt that never completed) —
 * the only failure that may be treated as a successful revocation. Trust a
 * structured HTTP status when the error carries one; otherwise accept only a
 * message that STARTS with "404" (the Composio SDK surfaces errors as
 * "<status> <raw response json>"). Anything looser — e.g. a "not found"
 * substring — would misclassify unrelated failures (a 500 whose body mentions
 * "not found", a "user not found" auth error) as confirmed revocation and
 * delete local state or prune a tombstone while the remote authorization is
 * still live. Unrecognized errors therefore fail CLOSED: the revocation
 * counts as unconfirmed, local state is kept, and reconciliation retries.
 */
function isAccountAlreadyGoneError(error: unknown): boolean {
	if (typeof error === "object" && error !== null) {
		const status =
			(error as { status?: unknown }).status ??
			(error as { statusCode?: unknown }).statusCode;
		if (typeof status === "number") {
			return status === 404;
		}
	}
	const message = error instanceof Error ? error.message : String(error);
	return /^\s*404\b/.test(message);
}

export async function disconnectComposioToolkit(
	toolkit: ComposioToolkitSlug,
	logger?: BasicLogger,
): Promise<ComposioStatusResponse> {
	const pending = pendingConnections.get(toolkit);
	pendingConnections.delete(toolkit);
	lastConnectionErrors.delete(toolkit);
	// Snapshot for decisions only — every persisted change below goes through
	// updateComposioState so a concurrent writer is never clobbered.
	const state = readReconciledComposioState(logger);
	if (pending) {
		// A still-open browser flow for this toolkit could complete after the
		// disconnect; treat the attempt exactly like an explicit cancel.
		updateComposioState((s) => {
			rememberCancelledAccountId(s, pending.connectedAccountId);
		});
		const confirmedGone = await revokeConnectedAccountQuietly(
			pending.apiKey,
			pending.connectedAccountId,
			logger,
		);
		if (confirmedGone) {
			pruneConfirmedCancelledAccount(pending.connectedAccountId);
		}
	}
	const stored = state.toolkits?.[toolkit];
	if (stored && state.apiKey) {
		try {
			const client = await getComposioClient(state.apiKey);
			await deleteConnectedAccountWithRevocation(
				client,
				stored.connectedAccountId,
			);
		} catch (error) {
			if (!isAccountAlreadyGoneError(error)) {
				// Revocation did NOT happen: the account is still authorized on
				// Composio's side, and running Hub sessions that loaded this
				// connector keep executing against it until the delete lands.
				// Removing only the local state would report an uninstall that
				// never took effect remotely — keep the connector installed and
				// surface the failure so the user retries. (Revoking from the
				// Composio dashboard works too: the next status refresh drops
				// the local state once the account is gone.)
				throw new Error(
					`Could not revoke the ${toolkit} connection: ${formatComposioError(error)}. The connector is still connected — try again, or revoke it from the Composio dashboard.`,
				);
			}
			// Already deleted on Composio's side; local removal is all that is
			// left to do.
			logger?.log?.(
				`composio disconnect ${toolkit}: account already gone remotely`,
			);
		}
	}
	let slotEmptyAfterRemoval = false;
	const next = updateComposioState((s) => {
		const current = s.toolkits?.[toolkit];
		// Remove only the account this disconnect actually revoked. A
		// connection finalized while the awaited revocation above was in
		// flight is the newer user intent: it carries a different account id
		// and its remote account was never touched — blindly deleting it here
		// would leave that account authorized with no local record, for the
		// next refresh to import as a resurrected connector.
		if (
			current &&
			stored &&
			current.connectedAccountId === stored.connectedAccountId &&
			s.toolkits
		) {
			delete s.toolkits[toolkit];
		}
		slotEmptyAfterRemoval = !s.toolkits?.[toolkit];
	});
	if (slotEmptyAfterRemoval) {
		// Only an effective disconnect stamps the marker; stamping over a
		// surviving newer connection would make later refreshes and
		// finalizations treat it as disconnected.
		lastDisconnectedAt.set(toolkit, Date.now());
	}
	return buildStatusResponse(next);
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

type FinalizeGuard = {
	/** Present for browser-flow attempts; the pending entry must still carry
	 * this id at write time (cancel/disconnect/key changes clear it). */
	attemptId?: string;
	/** The key/user the connection was initiated under. */
	apiKey: string;
	userId: string;
	/** When the connection attempt began. A disconnect of this toolkit that
	 * lands at or after this instant is the newer user intent: the finalize
	 * result is dropped and its account revoked instead of written. This is
	 * the only disconnect defense on the redirect-less path, which never has
	 * a pending entry for the disconnect to clear. */
	startedAt: number;
};

/** An attempt whose result must not be persisted — superseded by a
 * disconnect or key change, or failed from the app's point of view (wait
 * timeout/error, failed finalize) — can still leave an authorized account
 * behind on Composio's side that nothing references, and its browser flow
 * may even complete later. Tombstone it so reconciliation can never import
 * it, then revoke it — the same lifecycle as a cancelled attempt. */
async function abandonFinalizedConnection(
	connectedAccountId: string,
	apiKey: string,
	logger?: BasicLogger,
): Promise<void> {
	updateComposioState((s) => {
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
		apiKey,
		connectedAccountId,
		logger,
	);
	if (confirmedGone) {
		pruneConfirmedCancelledAccount(connectedAccountId);
	}
}

/** Returns whether the connection was actually persisted — a dropped result
 * (superseded attempt, key change, or a disconnect that won the race) must
 * not be reported as a successful connect by callers. */
async function finalizeToolkitConnection(
	client: ComposioClient,
	toolkit: ComposioToolkitSlug,
	connectedAccountId: string,
	guard: FinalizeGuard,
	logger?: BasicLogger,
): Promise<boolean> {
	const tools = await fetchToolkitTools(client, toolkit);
	// Everything below (up to the state write) runs synchronously, so these
	// write-time checks cannot be raced by a cancel, disconnect, or key
	// change that happened while the tool fetch (or the browser flow) was in
	// flight.
	if (
		guard.attemptId &&
		pendingConnections.get(toolkit)?.attemptId !== guard.attemptId
	) {
		// Whoever cleared the attempt (cancel, disconnect, key change) already
		// tombstoned and revoked its account.
		logger?.log?.(
			`composio connect ${toolkit}: attempt superseded before finalize; dropping result`,
		);
		return false;
	}
	const state = readComposioState();
	if (state.apiKey !== guard.apiKey || state.userId !== guard.userId) {
		logger?.log?.(
			`composio connect ${toolkit}: API key or user changed mid-flow; dropping stale connection`,
		);
		await abandonFinalizedConnection(connectedAccountId, guard.apiKey, logger);
		return false;
	}
	if ((lastDisconnectedAt.get(toolkit) ?? 0) >= guard.startedAt) {
		// The user disconnected this toolkit after the attempt began; writing
		// the result now would resurrect the connector they removed.
		logger?.log?.(
			`composio connect ${toolkit}: disconnected mid-finalize; dropping and revoking the new account`,
		);
		await abandonFinalizedConnection(connectedAccountId, guard.apiKey, logger);
		return false;
	}
	// No await separates the guard checks above from this write, so the
	// checked state cannot go stale in between.
	updateComposioState((s) => {
		s.toolkits = {
			...(s.toolkits ?? {}),
			[toolkit]: {
				connectedAccountId,
				connectedAt: new Date().toISOString(),
				...lookupCatalogDisplayInfo(toolkit),
				tools,
			},
		};
	});
	logger?.log?.(`composio connected ${toolkit} with ${tools.length} tool(s)`);
	return true;
}
