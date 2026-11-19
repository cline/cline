// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	invalidateExtensionInventoryCache,
	type McpServersResponse,
} from "@/lib/extension-inventory";
import { clearMarketplaceInstalledEntries } from "@/lib/marketplace-installed";
import {
	CustomizeRefreshButton,
	CustomizeRefreshProvider,
} from "../shared/customize-refresh";
import { useInstalledCustomizations } from "../use-installed-customizations";
import { McpServersContent } from "./mcp-view";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	refreshConnectors: vi.fn(async () => {}),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: () => () => {} },
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/marketplace", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/marketplace")>()),
	fetchMarketplaceCatalog: async () => ({
		version: 1,
		counts: { total: 0, plugins: 0, skills: 0, mcps: 0 },
		entries: [],
		tags: [],
	}),
}));
vi.mock("../connectors/use-connector-results", () => ({
	useConnectorResults: () => ({
		summary: { query: "", count: 0, loading: false, error: false },
		refreshStatus: mocks.refreshConnectors,
		refreshCatalog: mocks.refreshConnectors,
	}),
}));

const inventory: McpServersResponse = {
	settingsPath: "/settings/mcp.json",
	hasSettingsFile: true,
	servers: [
		{
			name: "local-tools",
			transportType: "stdio",
			command: "bun",
			disabled: false,
		},
	],
};

/** The section registers first, then its data owner's shared refresh runs last. */
function ManageMcp() {
	const model = useInstalledCustomizations({ tab: "mcp" });
	return (
		<McpServersContent
			marketplaceModel={model.marketplaceModels.mcp}
			onCreateMcp={() => {}}
			onOpenMcp={() => {}}
		/>
	);
}

let container: HTMLDivElement;
let root: Root;
let pendingInventory: Promise<McpServersResponse> | undefined;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	invalidateExtensionInventoryCache();
	clearMarketplaceInstalledEntries();
	pendingInventory = undefined;
	mocks.invoke.mockReset().mockImplementation(async (command: string) => {
		if (command === "list_mcp_servers") return pendingInventory ?? inventory;
		if (command === "list_user_instruction_configs") return { mcp: inventory };
		if (command === "list_marketplace_installed_entries")
			return { installedKeys: [] };
		if (command === "set_mcp_server_disabled") throw new Error("Toggle failed");
		throw new Error(`Unexpected command: ${command}`);
	});
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

it("clears MCP card and dialog errors only after the shared inventory refresh succeeds", async () => {
	await act(async () =>
		root.render(
			<CustomizeRefreshProvider enabled>
				<CustomizeRefreshButton />
				<ManageMcp />
			</CustomizeRefreshProvider>,
		),
	);
	const card = container.querySelector('[data-slot="item-card"]');
	const toggle = card?.querySelector<HTMLInputElement>(
		'[aria-label="Enable local-tools"]',
	);
	expect(toggle).not.toBeNull();
	await act(async () => toggle?.click());
	expect(card?.querySelector("output")?.textContent).toBe("Action failed");
	const dialog = document.querySelector('[role="dialog"]');
	expect(dialog?.textContent).toContain("Toggle failed");
	const refresh = container.querySelector<HTMLButtonElement>(
		'[aria-label="Refresh customizations"]',
	);
	expect(refresh).not.toBeNull();
	let failRefresh!: (reason: Error) => void;
	pendingInventory = new Promise((_resolve, reject) => {
		failRefresh = reject;
	});
	await act(async () => refresh?.click());
	await act(async () => failRefresh(new Error("Refresh failed")));
	expect(card?.querySelector("output")?.textContent).toBe("Action failed");
	expect(dialog?.textContent).toContain("Toggle failed");
	let finishRefresh!: (response: McpServersResponse) => void;
	pendingInventory = new Promise((resolve) => {
		finishRefresh = resolve;
	});
	mocks.invoke.mockClear();
	await act(async () => refresh?.click());
	expect(refresh?.disabled).toBe(true);
	expect(card?.querySelector("output")?.textContent).toBe("Action failed");
	expect(card?.querySelector('[aria-label="Enable local-tools"]')).toBeNull();
	expect(
		mocks.invoke.mock.calls.filter(
			([command]) => command === "list_mcp_servers",
		),
	).toHaveLength(1);
	await act(async () => finishRefresh(inventory));
	expect(refresh?.disabled).toBe(false);
	expect(card?.textContent).not.toContain("Action failed");
	expect(
		card?.querySelector<HTMLInputElement>('[aria-label="Enable local-tools"]')
			?.checked,
	).toBe(true);
	expect(document.querySelector('[role="dialog"]')).toBe(dialog);
	expect(dialog?.textContent).not.toContain("Toggle failed");
});
