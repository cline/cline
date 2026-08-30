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

export function fetchComposioStatus(options?: {
	refresh?: boolean;
}): Promise<ComposioStatusResponse> {
	return desktopClient.invoke<ComposioStatusResponse>("composio_integrations", {
		operation: "status",
		refresh: options?.refresh === true,
	});
}

export function fetchComposioToolkitCatalog(): Promise<ComposioCatalogResponse> {
	return desktopClient.invoke<ComposioCatalogResponse>(
		"composio_integrations",
		{ operation: "listToolkits" },
		{ timeoutMs: CONNECT_TIMEOUT_MS },
	);
}

export function saveComposioApiKey(
	apiKey: string,
): Promise<ComposioStatusResponse> {
	return desktopClient.invoke<ComposioStatusResponse>(
		"composio_integrations",
		{ operation: "setApiKey", apiKey },
		{ timeoutMs: CONNECT_TIMEOUT_MS },
	);
}

export function clearComposioApiKey(): Promise<ComposioStatusResponse> {
	return desktopClient.invoke<ComposioStatusResponse>("composio_integrations", {
		operation: "clearApiKey",
	});
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
