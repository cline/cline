// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MarketplaceCatalog } from "@/lib/marketplace";

const mocks = vi.hoisted(() => ({
	fetch: vi.fn(),
	invoke: vi.fn(),
	installed: vi.fn(),
	refreshConnectors: vi.fn(async () => {}),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: () => () => {} },
	resolveDesktopBackendHttpEndpoint: async () => {
		throw new Error("No sidecar");
	},
	openExternalUrl: vi.fn(),
}));
vi.mock("../connectors/use-connector-results", () => ({
	useConnectorResults: () => ({
		summary: { query: "", count: 0, loading: false, error: false },
		refreshStatus: mocks.refreshConnectors,
		refreshCatalog: mocks.refreshConnectors,
	}),
}));

const catalog: MarketplaceCatalog = {
	version: 1,
	counts: { total: 1, plugins: 1, skills: 0, mcps: 0 },
	tags: [],
	entries: [
		{
			id: "retry-plugin",
			type: "plugin",
			name: "Retry plugin",
			tagline: "Installed from the marketplace",
			description: "An installed plugin without matching local metadata",
			tags: [],
			install: { command: "", args: ["example/retry-plugin"] },
		},
	],
};
const mcpInventory = { settingsPath: "", hasSettingsFile: false, servers: [] };
const localInventory = { plugins: [], skills: [], mcp: mcpInventory };

let useInstalledCustomizations: typeof import("../use-installed-customizations").useInstalledCustomizations;
let InstalledMarketplaceItems: typeof import("./installed-marketplace-items").InstalledMarketplaceItems;
let CustomizeRefreshProvider: typeof import("../shared/customize-refresh").CustomizeRefreshProvider;
let CustomizeRefreshButton: typeof import("../shared/customize-refresh").CustomizeRefreshButton;

function ManagePlugins() {
	const model = useInstalledCustomizations({ tab: "plugins" });
	return (
		<>
			<output
				aria-label="Installed summary"
				data-error={model.summary.error}
				data-loading={model.summary.loading}
				data-count={model.summary.count}
			/>
			<InstalledMarketplaceItems
				model={model.marketplaceModels.plugins}
				primitive="plugin"
			/>
		</>
	);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
	// Keep the real catalog and installed-status caches, with a fresh instance
	// per scenario so a previous successful response cannot mask a failed read.
	vi.resetModules();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("fetch", mocks.fetch);
	mocks.fetch
		.mockReset()
		.mockImplementation(async () => Response.json(catalog));
	mocks.installed
		.mockReset()
		.mockResolvedValue({ installedKeys: ["plugin:retry-plugin"] });
	mocks.invoke.mockReset().mockImplementation(async (command: string) => {
		if (command === "list_user_instruction_configs") return localInventory;
		if (command === "list_mcp_servers") return mcpInventory;
		if (command === "list_marketplace_installed_entries")
			return mocks.installed();
		throw new Error(`Unexpected command: ${command}`);
	});
	({ useInstalledCustomizations } = await import(
		"../use-installed-customizations"
	));
	({ InstalledMarketplaceItems } = await import(
		"./installed-marketplace-items"
	));
	({ CustomizeRefreshProvider, CustomizeRefreshButton } = await import(
		"../shared/customize-refresh"
	));
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

async function render() {
	await act(async () =>
		root.render(
			<CustomizeRefreshProvider enabled>
				<CustomizeRefreshButton />
				<ManagePlugins />
			</CustomizeRefreshProvider>,
		),
	);
}

async function refresh() {
	const button = container.querySelector<HTMLButtonElement>(
		'[aria-label="Refresh customizations"]',
	);
	expect(button).not.toBeNull();
	await act(async () => button?.click());
	expect(button?.disabled).toBe(false);
}

function summary() {
	return container.querySelector('[aria-label="Installed summary"]');
}

function expectRecovered() {
	expect(
		container.querySelector('[aria-label="View Retry plugin details"]'),
	).not.toBeNull();
	expect(container.querySelector('[role="alert"]')).toBeNull();
	expect(summary()?.getAttribute("data-error")).toBe("false");
	expect(summary()?.getAttribute("data-loading")).toBe("false");
	expect(summary()?.getAttribute("data-count")).toBe("1");
}

it("retries a failed marketplace catalog from shared Refresh without changing local inventory", async () => {
	mocks.fetch.mockRejectedValue(new Error("Catalog unavailable"));
	await render();
	expect(container.querySelector('[role="alert"]')?.textContent).toBe(
		"Catalog unavailable",
	);
	expect(summary()?.getAttribute("data-error")).toBe("true");
	expect(mocks.fetch).toHaveBeenCalledOnce();

	mocks.fetch.mockRejectedValue(new Error("Catalog still unavailable"));
	await refresh();
	expect(mocks.fetch).toHaveBeenCalledTimes(2);
	expect(container.querySelector('[role="alert"]')?.textContent).toBe(
		"Catalog still unavailable",
	);
	expect(summary()?.getAttribute("data-error")).toBe("true");

	mocks.fetch.mockImplementation(async () => Response.json(catalog));
	await refresh();
	expect(mocks.fetch).toHaveBeenCalledTimes(3);
	expectRecovered();
});

it("retries failed installed status from shared Refresh when the local item signature stays the same", async () => {
	mocks.installed.mockRejectedValue(new Error("Installed status unavailable"));
	await render();
	expect(container.querySelector('[role="alert"]')?.textContent).toBe(
		"Unable to check installed marketplace entries.",
	);
	expect(summary()?.getAttribute("data-error")).toBe("true");
	expect(mocks.installed).toHaveBeenCalledOnce();

	await refresh();
	expect(mocks.installed).toHaveBeenCalledTimes(2);
	expect(container.querySelector('[role="alert"]')?.textContent).toBe(
		"Unable to check installed marketplace entries.",
	);
	expect(summary()?.getAttribute("data-error")).toBe("true");

	mocks.installed.mockResolvedValue({ installedKeys: ["plugin:retry-plugin"] });
	await refresh();
	expect(mocks.installed).toHaveBeenCalledTimes(3);
	expectRecovered();
});
