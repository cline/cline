// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposioCatalogResponse } from "@/lib/composio-types";

const mocks = vi.hoisted(() => ({
	configured: true,
	catalog: vi.fn(),
}));
vi.mock("@/lib/composio", () => ({
	fetchComposioToolkitCatalog: mocks.catalog,
}));
vi.mock("@/lib/use-composio-connections", () => ({
	useComposioConnections: () => ({
		configured: mocks.configured,
		statusBySlug: new Map(),
	}),
}));
vi.mock("@/lib/marketplace", () => ({
	fetchMarketplaceCatalog: async () => ({ entries: [], tags: [] }),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: async () => ({ installedKeys: [] }) },
	openExternalUrl: vi.fn(),
}));

import { MarketplaceExplorerView } from "./marketplace-explorer-view";

let container: HTMLDivElement;
let root: Root;
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
	mocks.configured = true;
	mocks.catalog.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});
async function render() {
	await act(async () => root.render(<MarketplaceExplorerView />));
}
function connectorFilter() {
	return [...container.querySelectorAll("button")].find((button) =>
		button.textContent?.trim().startsWith("Connectors"),
	);
}

describe("Marketplace connector catalog states", () => {
	it("keeps the filter visible while loading and after an empty response", async () => {
		let finish!: (response: ComposioCatalogResponse) => void;
		mocks.catalog.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		await render();
		expect(connectorFilter()).toBeDefined();
		expect(container.textContent).toContain("Loading connectors...");
		await act(async () => connectorFilter()?.click());
		await act(async () => finish({ configured: true, toolkits: [] }));
		expect(connectorFilter()?.getAttribute("aria-pressed")).toBe("true");
		expect(container.textContent).toContain(
			"No connectors are available for your account yet.",
		);
		expect(container.textContent).not.toContain("No entries match");
	});

	it("shows a catalog error and retries without hiding the filter", async () => {
		mocks.catalog
			.mockRejectedValueOnce(new Error("Service unavailable"))
			.mockResolvedValueOnce({
				configured: true,
				toolkits: [{ slug: "gmail", name: "Gmail" }],
			});
		await render();
		expect(connectorFilter()).toBeDefined();
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Service unavailable",
		);
		const retry = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Retry",
		);
		expect(retry).toBeDefined();
		await act(async () => retry?.click());
		expect(mocks.catalog).toHaveBeenCalledTimes(2);
		expect(container.textContent).toContain("Gmail");
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});

	it("does not fetch or show connectors for an account without access", async () => {
		mocks.configured = false;
		await render();
		expect(connectorFilter()).toBeUndefined();
		expect(mocks.catalog).not.toHaveBeenCalled();
		expect(container.textContent).not.toContain("Loading connectors");
	});
});
