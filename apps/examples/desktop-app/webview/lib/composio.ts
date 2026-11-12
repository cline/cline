import type {
	ComposioCatalogResponse,
	ComposioConnectResponse,
	ComposioStatusResponse,
	ComposioToolkitSlug,
} from "./composio-types";
import { desktopClient } from "./desktop-client";

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
type StatusMutation = {
	generation: number;
	revision: number;
	promise: Promise<unknown>;
	readStatus: (result: unknown) => ComposioStatusResponse;
};
let statusMutation: StatusMutation | null = null;

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

function commitStatus(status: ComposioStatusResponse) {
	statusCache = { value: status, fetchedAt: Date.now() };
	publishAvailability(status.configured);
	publishStatus({ status, loading: false, error: null });
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
function getCachedComposioStatus(): ComposioStatusResponse | null {
	return statusCache?.value ?? null;
}

function invalidateComposioCache() {
	availabilityGeneration++;
	statusRevision++;
	statusCache = null;
	catalogCache = null;
	statusRequest = null;
	catalogRequest = null;
	statusMutation = null;
	publishAvailability(null);
	publishStatus(EMPTY_STATUS_SNAPSHOT);
	if (statusListeners.size > 0) void fetchComposioStatus().catch(() => {});
}

export function resetComposioCacheForTesting() {
	unsubscribeSettings?.();
	unsubscribeSettings = null;
	availabilityListeners.clear();
	statusListeners.clear();
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

function resolveCurrentStatus(
	excludedMutation?: StatusMutation,
): Promise<ComposioStatusResponse> {
	if (statusRequest) return statusRequest.promise;
	const mutation = statusMutation;
	if (mutation && mutation !== excludedMutation) {
		return mutation.promise.then(
			(result) => {
				if (
					mutation.generation !== availabilityGeneration ||
					mutation.revision !== statusRevision
				) {
					return resolveCurrentStatus(mutation);
				}
				return mutation.readStatus(result);
			},
			() => resolveCurrentStatus(mutation),
		);
	}
	if (statusCache) return Promise.resolve(statusCache.value);
	if (statusMutation === excludedMutation) statusMutation = null;
	return fetchComposioStatus();
}

export function fetchComposioStatus(options?: {
	refresh?: boolean;
}): Promise<ComposioStatusResponse> {
	observeAvailabilitySettings();
	if (statusMutation) return resolveCurrentStatus();
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
	const request = desktopClient.invoke<ComposioStatusResponse>(
		"composio_integrations",
		{
			operation: "status",
			refresh,
		},
	);
	const promise = request
		.then(
			(status) => {
				if (
					generation !== availabilityGeneration ||
					revision !== statusRevision ||
					statusRequest?.promise !== promise
				) {
					return resolveCurrentStatus();
				}
				commitStatus(status);
				return status;
			},
			(error: unknown) => {
				if (
					generation !== availabilityGeneration ||
					revision !== statusRevision ||
					statusRequest?.promise !== promise
				) {
					return resolveCurrentStatus();
				}
				publishStatus({
					status: getCachedComposioStatus(),
					loading: false,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			},
		)
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

function resolveCurrentCatalog(
	excludedRequest?: Promise<ComposioCatalogResponse>,
): Promise<ComposioCatalogResponse> {
	if (catalogRequest && catalogRequest !== excludedRequest)
		return catalogRequest;
	if (catalogCache) return Promise.resolve(catalogCache.value);
	if (catalogRequest === excludedRequest) catalogRequest = null;
	return fetchComposioToolkitCatalog();
}

export function fetchComposioToolkitCatalog(): Promise<ComposioCatalogResponse> {
	observeAvailabilitySettings();
	if (catalogRequest) return catalogRequest;
	if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS)
		return Promise.resolve(catalogCache.value);
	const generation = availabilityGeneration;
	const request = desktopClient.invoke<ComposioCatalogResponse>(
		"composio_integrations",
		{ operation: "listToolkits" },
		{ timeoutMs: CONNECT_TIMEOUT_MS },
	);
	const promise = request
		.then(
			(catalog) => {
				if (
					generation !== availabilityGeneration ||
					catalogRequest !== promise
				) {
					return resolveCurrentCatalog(promise);
				}
				catalogCache = { value: catalog, fetchedAt: Date.now() };
				return catalog;
			},
			(error: unknown) => {
				if (
					generation !== availabilityGeneration ||
					catalogRequest !== promise
				) {
					return resolveCurrentCatalog(promise);
				}
				throw error;
			},
		)
		.finally(() => {
			if (catalogRequest === promise) catalogRequest = null;
		});
	catalogRequest = promise;
	return promise;
}

function runStatusMutation<T>(
	load: () => Promise<T>,
	readStatus: (result: T) => ComposioStatusResponse,
): Promise<T> {
	observeAvailabilitySettings();
	statusRevision++;
	statusRequest = null;
	publishStatus({ ...statusSnapshot, loading: false });
	let mutation: StatusMutation;
	const promise = Promise.resolve()
		.then(load)
		.then((result) => {
			if (
				statusMutation === mutation &&
				mutation.generation === availabilityGeneration &&
				mutation.revision === statusRevision
			) {
				commitStatus(readStatus(result));
			}
			return result;
		})
		.finally(() => {
			if (statusMutation === mutation) statusMutation = null;
		});
	mutation = {
		generation: availabilityGeneration,
		revision: statusRevision,
		promise,
		readStatus: (result) => readStatus(result as T),
	};
	statusMutation = mutation;
	return promise;
}

export function connectComposioIntegration(
	toolkit: ComposioToolkitSlug,
): Promise<ComposioConnectResponse> {
	return runStatusMutation(
		() =>
			desktopClient.invoke<ComposioConnectResponse>(
				"composio_integrations",
				{ operation: "connect", toolkit },
				{ timeoutMs: CONNECT_TIMEOUT_MS },
			),
		(result) => result.status,
	);
}

export function cancelComposioConnect(
	toolkit: ComposioToolkitSlug,
): Promise<ComposioStatusResponse> {
	return runStatusMutation(
		() =>
			desktopClient.invoke<ComposioStatusResponse>("composio_integrations", {
				operation: "cancelConnect",
				toolkit,
			}),
		(status) => status,
	);
}

export function disconnectComposioIntegration(
	toolkit: ComposioToolkitSlug,
): Promise<ComposioStatusResponse> {
	return runStatusMutation(
		() =>
			desktopClient.invoke<ComposioStatusResponse>(
				"composio_integrations",
				{ operation: "disconnect", toolkit },
				{ timeoutMs: CONNECT_TIMEOUT_MS },
			),
		(status) => status,
	);
}
