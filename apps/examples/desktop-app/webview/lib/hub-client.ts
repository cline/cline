"use client";
import {
	BrowserHubClient,
	createHubMcpApi,
	createHubPluginCommandsApi,
	createHubProviderAuthApi,
	createHubProvidersApi,
	type HubBrowserConnection,
	type HubCommandClient,
} from "@cline/core/hub/browser";
import {
	isTauriAvailable,
	resolveDesktopBackendHttpEndpoint,
} from "./desktop-client";

const clients = new Map<string, BrowserHubClient>();
async function bootstrap(environmentId: string): Promise<HubBrowserConnection> {
	if (isTauriAvailable()) {
		const { invoke } = await import("@tauri-apps/api/core");
		return invoke<HubBrowserConnection>("get_desktop_hub_connection", {
			environmentId,
		});
	}
	const url = new URL(
		`${await resolveDesktopBackendHttpEndpoint()}/hub/connection`,
	);
	url.searchParams.set("environmentId", environmentId);
	const response = await fetch(url, { cache: "no-store" });
	if (!response.ok)
		throw new Error(
			"Hub bootstrap is unavailable; run dev:sidecar for browser development",
		);
	return response.json();
}
export function getDesktopHubClient(environmentId = "local"): BrowserHubClient {
	let client = clients.get(environmentId);
	if (!client) {
		client = new BrowserHubClient(() => bootstrap(environmentId));
		clients.set(environmentId, client);
	}
	return client;
}
const local: HubCommandClient = {
	command: (...args) => getDesktopHubClient().command(...args),
};
export const hubProviders = createHubProvidersApi(local);
export const hubAccount = createHubProviderAuthApi(local);
export const hubMcp = createHubMcpApi(local);
export function hubPlugins(environmentId = "local") {
	return createHubPluginCommandsApi(getDesktopHubClient(environmentId));
}
if (typeof window !== "undefined")
	window.addEventListener("pagehide", () => {
		for (const client of clients.values()) void client.dispose();
		clients.clear();
	});
