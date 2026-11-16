// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribe: vi.fn(),
	fetch: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: mocks.subscribe },
	resolveDesktopBackendHttpEndpoint: async () => "http://localhost:3126",
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/use-composio-catalog", () => ({
	useComposioCatalog: () => ({
		catalog: null,
		loading: false,
		error: null,
		refresh: async () => {},
	}),
}));
vi.mock("@/lib/use-composio-status", () => ({
	useComposioStatus: () => ({
		status: { configured: false, integrations: [] },
		loading: false,
		error: null,
		refresh: async () => {},
	}),
}));
vi.mock("@/lib/composio", () => ({
	getCachedComposioStatus: () => ({ configured: false }),
	getCachedComposioToolkitCatalog: () => null,
	fetchComposioStatus: async () => ({ configured: false }),
	fetchComposioToolkitCatalog: vi.fn(),
}));
vi.mock("./connectors/composio-connectors-view", () => ({
	ConnectorCatalogView: () => null,
	InstalledConnectorsView: () => null,
}));

import type { MarketplacePrimitiveType } from "@/lib/marketplace";
import { InstalledMarketplaceItems } from "./marketplace/installed-marketplace-items";
import { MarketplaceExplorerView } from "./marketplace/marketplace-explorer-view";
import { useInstalledMarketplaceItems } from "./marketplace/use-installed-marketplace-items";

const catalog = {
	version: 1,
	counts: { total: 1, plugins: 0, skills: 0, mcps: 1 },
	tags: [],
	entries: [
		{
			id: "example-server",
			type: "mcp",
			name: "Example server",
			tagline: "An example server",
			description: "An installed server",
			tags: [],
			install: { command: "", args: ["example/server"] },
		},
	],
};

function InstalledItems({
	primitive,
}: {
	primitive: MarketplacePrimitiveType;
}) {
	const model = useInstalledMarketplaceItems({ primitive });
	return <InstalledMarketplaceItems model={model} primitive={primitive} />;
}

function CustomizeContent({ mode }: { mode: "browse" | "manage" }) {
	return mode === "browse" ? (
		<MarketplaceExplorerView
			typeFilter="mcp"
			onTypeFilterChange={() => {}}
			onOpenDetail={() => {}}
			onCreateMcp={() => {}}
		/>
	) : (
		(["skill", "plugin", "mcp"] as const).map((primitive) => (
			<InstalledItems key={primitive} primitive={primitive} />
		))
	);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("fetch", mocks.fetch);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	mocks.subscribe.mockReturnValue(() => {});
	mocks.fetch.mockResolvedValue({ ok: true, json: async () => catalog });
	mocks.invoke.mockResolvedValue({ installedKeys: ["mcp:example-server"] });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("switches between warmed Browse and Manage content immediately and refreshes expired data without a loading gap", async () => {
	let now = 10_000_000;
	vi.spyOn(Date, "now").mockImplementation(() => now);
	await act(async () => root.render(<CustomizeContent mode="browse" />));
	expect(container.textContent).toContain("Example server");
	expect(container.textContent).toContain("Installed");
	expect(mocks.fetch).toHaveBeenCalledTimes(1);
	expect(mocks.invoke).toHaveBeenCalledTimes(1);

	for (const mode of ["manage", "browse", "manage", "browse"] as const) {
		// Inspect the first committed render, before cached promises resolve.
		act(() => root.render(<CustomizeContent mode={mode} />));
		expect(container.textContent).toContain("Example server");
		expect(container.textContent).not.toMatch(/Loading marketplace|Checking/);
		await act(async () => {});
	}
	expect(mocks.fetch).toHaveBeenCalledTimes(1);
	expect(mocks.invoke).toHaveBeenCalledTimes(1);

	now += 5 * 60_000;
	let finishCatalog!: (value: unknown) => void;
	let finishInstalled!: (value: { installedKeys: string[] }) => void;
	mocks.fetch.mockReturnValue(
		new Promise((resolve) => {
			finishCatalog = resolve;
		}),
	);
	mocks.invoke.mockReturnValue(
		new Promise((resolve) => {
			finishInstalled = resolve;
		}),
	);
	act(() => root.render(<CustomizeContent mode="manage" />));
	expect(container.textContent).toContain("Example server");
	expect(container.textContent).not.toMatch(/Loading marketplace|Checking/);
	await act(async () => {});
	// The three Manage sections share both background refreshes.
	expect(mocks.fetch).toHaveBeenCalledTimes(2);
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
	await act(async () => {
		finishCatalog({
			ok: true,
			json: async () => ({
				...catalog,
				entries: [{ ...catalog.entries[0], name: "Updated server" }],
			}),
		});
		finishInstalled({ installedKeys: ["mcp:example-server"] });
	});
	expect(container.textContent).toContain("Updated server");
	expect(container.textContent).not.toMatch(/Loading marketplace|Checking/);
	expect(mocks.fetch).toHaveBeenCalledTimes(2);
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
});
