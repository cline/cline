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

// Availability is UI state, not authorization. Retain it across page mounts;
// the sidecar still checks account access for every connector operation.
let availability: boolean | null = null;
let availabilityGeneration = 0;
let observingSettings = false;
const availabilityListeners = new Set<() => void>();

function publishAvailability(next: boolean | null) {
	if (availability === next) return;
	availability = next;
	for (const listener of availabilityListeners) listener();
}

function observeAvailabilitySettings() {
	if (observingSettings) return;
	observingSettings = true;
	// Keep observing while pages are unmounted so signing out elsewhere also
	// invalidates the cached value. This subscription lives with the client.
	desktopClient.subscribe("settings.changed", () => {
		availabilityGeneration++;
		publishAvailability(null);
	});
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

export async function fetchComposioStatus(options?: {
	refresh?: boolean;
}): Promise<ComposioStatusResponse> {
	observeAvailabilitySettings();
	const generation = availabilityGeneration;
	const status = await desktopClient.invoke<ComposioStatusResponse>(
		"composio_integrations",
		{
			operation: "status",
			refresh: options?.refresh === true,
		},
	);
	if (generation === availabilityGeneration)
		publishAvailability(status.configured);
	return status;
}

export function fetchComposioToolkitCatalog(): Promise<ComposioCatalogResponse> {
	return desktopClient.invoke<ComposioCatalogResponse>(
		"composio_integrations",
		{ operation: "listToolkits" },
		{ timeoutMs: CONNECT_TIMEOUT_MS },
	);
}

export function connectComposioIntegration(
	toolkit: ComposioToolkitSlug,
): Promise<ComposioConnectResponse> {
	return desktopClient.invoke<ComposioConnectResponse>(
		"composio_integrations",
		{ operation: "connect", toolkit },
		{ timeoutMs: CONNECT_TIMEOUT_MS },
	);
}

export function cancelComposioConnect(
	toolkit: ComposioToolkitSlug,
): Promise<ComposioStatusResponse> {
	return desktopClient.invoke<ComposioStatusResponse>("composio_integrations", {
		operation: "cancelConnect",
		toolkit,
	});
}

export function disconnectComposioIntegration(
	toolkit: ComposioToolkitSlug,
): Promise<ComposioStatusResponse> {
	return desktopClient.invoke<ComposioStatusResponse>(
		"composio_integrations",
		{ operation: "disconnect", toolkit },
		{ timeoutMs: CONNECT_TIMEOUT_MS },
	);
}
