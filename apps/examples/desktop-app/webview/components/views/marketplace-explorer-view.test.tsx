// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("Marketplace directory", () => {
	it("does not show or fetch connectors, which live in Customize", async () => {
		await render();
		expect(connectorFilter()).toBeUndefined();
		expect(mocks.catalog).not.toHaveBeenCalled();
		expect(
			container.querySelector('input[aria-label="Search marketplace"]'),
		).not.toBeNull();
	});
});
