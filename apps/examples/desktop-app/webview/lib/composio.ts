import type {
	ComposioCatalogResponse,
	ComposioConnectResponse,
	ComposioStatusResponse,
	ComposioToolkitSlug,
} from "./composio-types";
import { desktopClient } from "./desktop-client";
import { invalidateExtensionInventoryCache } from "./extension-inventory";

/**
 * Webview client for the sidecar's `composio_integrations` command — the
 * management plane for the Gmail / Google Calendar / GitHub integrations.
 */

/** `connect` performs a round-trip to Composio (create auth config, initiate
 * the connection) before it can return the OAuth URL — give it headroom. */
const CONNECT_TIMEOUT_MS = 60_000;
const STATUS_TTL_MS = 60_000;
const CATALOG_TTL_MS = 60 * 60_000;
const CONNECT_POLL_INTERVAL_MS = 3_000;

type Cached<T> = { value: T; fetchedAt: number };
let statusCache: Cached<ComposioStatusResponse> | null = null;
let catalogCache: Cached<ComposioCatalogResponse> | null = null;
let statusRevision = 0;
let statusRequest: {
	promise: Promise<ComposioStatusResponse>;
	refresh: boolean;
} | null = null;
let catalogRequest: Promise<ComposioCatalogResponse> | null = null;

export type ComposioStatusSnapshot = {
	status: ComposioStatusResponse | null;
	loading: boolean;
	error: string | null;
};

const EMPTY_STATUS_SNAPSHOT: ComposioStatusSnapshot = {
	status: null,
	loading: false,
	error: null,
};
let statusSnapshot = EMPTY_STATUS_SNAPSHOT;
const statusListeners = new Set<() => void>();
let statusPoll: ReturnType<typeof setInterval> | undefined;

function updateStatusPolling() {
	const pending = statusSnapshot.status?.integrations.some(
		(integration) => integration.status === "pending",
	);
	if (statusListeners.size === 0 || !pending) {
		clearInterval(statusPoll);
		statusPoll = undefined;
	} else if (statusPoll === undefined) {
		// OAuth completes outside the app. Keep one poller for all active data
		// consumers, including result models whose cards are currently unmounted.
		statusPoll = setInterval(() => {
			if (!statusRequest) void fetchComposioStatus().catch(() => {});
		}, CONNECT_POLL_INTERVAL_MS);
	}
}

export type ComposioCatalogSnapshot = {
	catalog: ComposioCatalogResponse | null;
	loading: boolean;
	error: string | null;
};
const EMPTY_CATALOG_SNAPSHOT: ComposioCatalogSnapshot = {
	catalog: null,
	loading: false,
	error: null,
};
let catalogSnapshot = EMPTY_CATALOG_SNAPSHOT;
const catalogListeners = new Set<() => void>();

function publishCatalog(next: ComposioCatalogSnapshot) {
	if (
		next.catalog === catalogSnapshot.catalog &&
		next.loading === catalogSnapshot.loading &&
		next.error === catalogSnapshot.error
	)
		return;
	catalogSnapshot = next;
	for (const listener of catalogListeners) listener();
}

export const getComposioCatalogSnapshot = () => catalogSnapshot;
export const getServerComposioCatalogSnapshot = () => EMPTY_CATALOG_SNAPSHOT;

export function subscribeComposioCatalog(listener: () => void) {
	observeAvailabilitySettings();
	catalogListeners.add(listener);
	return () => {
		catalogListeners.delete(listener);
	};
}

function publishStatus(next: ComposioStatusSnapshot) {
	if (
		next.status === statusSnapshot.status &&
		next.loading === statusSnapshot.loading &&
		next.error === statusSnapshot.error
	)
		return;
	statusSnapshot = next;
	updateStatusPolling();
	for (const listener of statusListeners) listener();
}

function inventorySignature(status: ComposioStatusResponse) {
	return JSON.stringify(
		status.integrations.map(({ toolkit, status }) => [toolkit, status]).sort(),
	);
}

/** Connection changes affect extension tools even when their cards are unmounted. */
function commitStatus(status: ComposioStatusResponse, mutation = false) {
	const previous = statusSnapshot.status;
	statusCache = { value: status, fetchedAt: Date.now() };
	publishAvailability(status.configured);
	publishStatus({ status, loading: false, error: null });
	if (
		mutation ||
		(previous && inventorySignature(previous) !== inventorySignature(status))
	) {
		invalidateExtensionInventoryCache();
	}
}

export const getComposioStatusSnapshot = () => statusSnapshot;
export const getServerComposioStatusSnapshot = () => EMPTY_STATUS_SNAPSHOT;

/** One request and one published status/error pair for every mounted surface. */
export function subscribeComposioStatus(listener: () => void) {
	statusListeners.add(listener);
	// A newly mounted consumer can revalidate an expired snapshot; concurrent
	// subscribers still share the same request and fresh reads remain cached.
	void fetchComposioStatus().catch(() => {});
	updateStatusPolling();
	return () => {
		statusListeners.delete(listener);
		updateStatusPolling();
	};
}

// Availability is UI state, not authorization. Retain it across page mounts;
// the sidecar still checks account access for every connector operation.
let availability: boolean | null = null;
let availabilityGeneration = 0;
let unsubscribeSettings: (() => void) | null = null;
const availabilityListeners = new Set<() => void>();

/** Retain expired snapshots for rendering while the next read refreshes them. */
export function getCachedComposioStatus(): ComposioStatusResponse | null {
	return statusCache?.value ?? null;
}

export function getCachedComposioToolkitCatalog(): ComposioCatalogResponse | null {
	return catalogCache?.value ?? null;
}

export function invalidateComposioCache() {
	availabilityGeneration++;
	statusRevision++;
	statusCache = null;
	catalogCache = null;
	statusRequest = null;
	catalogRequest = null;
	publishAvailability(null);
	publishStatus(EMPTY_STATUS_SNAPSHOT);
	publishCatalog(EMPTY_CATALOG_SNAPSHOT);
	if (statusListeners.size > 0) void fetchComposioStatus().catch(() => {});
}

export function resetComposioCacheForTesting() {
	unsubscribeSettings?.();
	unsubscribeSettings = null;
	availabilityListeners.clear();
	statusListeners.clear();
	catalogListeners.clear();
	invalidateComposioCache();
}

function publishAvailability(next: boolean | null) {
	if (availability === next) return;
	availability = next;
	for (const listener of availabilityListeners) listener();
}

function observeAvailabilitySettings() {
	if (unsubscribeSettings) return;
	// Keep observing while pages are unmounted so signing out elsewhere also
	// invalidates the cached value. This subscription lives with the client.
	unsubscribeSettings = desktopClient.subscribe(
		"settings.changed",
		invalidateComposioCache,
	);
}

export function getComposioAvailability(): boolean | null {
	return availability;
}

export function subscribeComposioAvailability(listener: () => void) {
	observeAvailabilitySettings();
	availabilityListeners.add(listener);
	return () => {
		availabilityListeners.delete(listener);
	};
}

export function fetchComposioStatus(options?: {
	refresh?: boolean;
}): Promise<ComposioStatusResponse> {
	observeAvailabilitySettings();
	const pendingConnection = statusCache?.value.integrations.some(
		(entry) => entry.status === "pending",
	);
	const expired =
		statusCache !== null && Date.now() - statusCache.fetchedAt >= STATUS_TTL_MS;
	// Cold loads and expired snapshots reconcile remote changes. Pending OAuth
	// polling continues to use the sidecar's local connection state.
	const refresh =
		options?.refresh === true ||
		((!statusCache || expired) && !pendingConnection);
	if (statusRequest && (!refresh || statusRequest.refresh))
		return statusRequest.promise;
	if (!refresh && statusCache && !expired && !pendingConnection) {
		return Promise.resolve(statusCache.value);
	}
	const generation = availabilityGeneration;
	const revision = statusRevision;
	const promise = desktopClient
		.invoke<ComposioStatusResponse>("composio_integrations", {
			operation: "status",
			refresh,
		})
		.then((status) => {
			if (
				generation === availabilityGeneration &&
				revision === statusRevision &&
				statusRequest?.promise === promise
			) {
				commitStatus(status);
			}
			return status;
		})
		.catch((error: unknown) => {
			if (
				generation === availabilityGeneration &&
				revision === statusRevision &&
				statusRequest?.promise === promise
			) {
				publishStatus({
					status: getCachedComposioStatus(),
					loading: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			throw error;
		})
		.finally(() => {
			if (statusRequest?.promise === promise) statusRequest = null;
		});
	statusRequest = { promise, refresh };
	publishStatus({
		status: getCachedComposioStatus(),
		loading: true,
		error: null,
	});
	return promise;
}

export function fetchComposioToolkitCatalog(): Promise<ComposioCatalogResponse> {
	observeAvailabilitySettings();
	if (catalogRequest) return catalogRequest;
	if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS)
		return Promise.resolve(catalogCache.value);
	const generation = availabilityGeneration;
	const promise = desktopClient
		.invoke<ComposioCatalogResponse>(
			"composio_integrations",
			{ operation: "listToolkits" },
			{ timeoutMs: CONNECT_TIMEOUT_MS },
		)
		.then((catalog) => {
			if (generation === availabilityGeneration && catalogRequest === promise) {
				catalogCache = { value: catalog, fetchedAt: Date.now() };
				publishCatalog({ catalog, loading: false, error: null });
			}
			return catalog;
		})
		.catch((error: unknown) => {
			if (generation === availabilityGeneration && catalogRequest === promise) {
				publishCatalog({
					catalog: getCachedComposioToolkitCatalog(),
					loading: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			throw error;
		})
		.finally(() => {
			if (catalogRequest === promise) catalogRequest = null;
		});
	catalogRequest = promise;
	publishCatalog({
		catalog: getCachedComposioToolkitCatalog(),
		loading: true,
		error: null,
	});
	return promise;
}

function beginStatusMutation() {
	observeAvailabilitySettings();
	statusRevision++;
	statusRequest = null;
	publishStatus({ ...statusSnapshot, loading: false });
	return availabilityGeneration;
}

function cacheMutationStatus(
	status: ComposioStatusResponse,
	generation: number,
) {
	if (generation !== availabilityGeneration) return;
	// Discard reads begun both before and during the mutation.
	statusRevision++;
	statusRequest = null;
	commitStatus(status, true);
}

export async function connectComposioIntegration(
	toolkit: ComposioToolkitSlug,
): Promise<ComposioConnectResponse> {
	const generation = beginStatusMutation();
	const result = await desktopClient.invoke<ComposioConnectResponse>(
		"composio_integrations",
		{ operation: "connect", toolkit },
		{ timeoutMs: CONNECT_TIMEOUT_MS },
	);
	cacheMutationStatus(result.status, generation);
	return result;
}

export async function cancelComposioConnect(
	toolkit: ComposioToolkitSlug,
): Promise<ComposioStatusResponse> {
	const generation = beginStatusMutation();
	const status = await desktopClient.invoke<ComposioStatusResponse>(
		"composio_integrations",
		{
			operation: "cancelConnect",
			toolkit,
		},
	);
	cacheMutationStatus(status, generation);
	return status;
}

export async function disconnectComposioIntegration(
	toolkit: ComposioToolkitSlug,
): Promise<ComposioStatusResponse> {
	const generation = beginStatusMutation();
	const status = await desktopClient.invoke<ComposioStatusResponse>(
		"composio_integrations",
		{ operation: "disconnect", toolkit },
		{ timeoutMs: CONNECT_TIMEOUT_MS },
	);
	cacheMutationStatus(status, generation);
	return status;
}
