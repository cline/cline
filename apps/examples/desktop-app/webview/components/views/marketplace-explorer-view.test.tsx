// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	configured: true,
	catalog: vi.fn(),
	marketplace: vi.fn(),
	connect: vi.fn(),
}));
vi.mock("@/lib/composio", () => ({
	fetchComposioToolkitCatalog: mocks.catalog,
	fetchComposioStatus: async () => ({ configured: mocks.configured }),
}));
vi.mock("@/lib/use-composio-connections", () => ({
	useComposioConnections: () => ({
		configured: mocks.configured,
		status: { integrations: [] },
		statusBySlug: new Map(),
		connect: mocks.connect,
	}),
}));
vi.mock("@/lib/marketplace", () => ({
	fetchMarketplaceCatalog: mocks.marketplace,
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: async () => ({ installedKeys: [] }),
		subscribe: () => () => {},
	},
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
	mocks.connect.mockReset();
	mocks.catalog.mockResolvedValue({
		toolkits: [
			{ slug: "gmail", name: "Gmail" },
			{ slug: "github", name: "GitHub" },
		],
	});
	mocks.marketplace.mockReset();
	mocks.marketplace.mockResolvedValue({ entries: [], tags: [] });
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
	it("hides connectors and does not fetch their catalog without beta access", async () => {
		mocks.configured = false;
		await render();
		expect(connectorFilter()).toBeUndefined();
		expect(mocks.catalog).not.toHaveBeenCalled();
		expect(
			container.querySelector('input[aria-label="Search marketplace"]'),
		).not.toBeNull();
	});
	it("shows the shared connector cards in All and the Connectors filter, with marketplace search and install", async () => {
		await render();
		expect(container.textContent).toContain("Gmail");
		expect(container.textContent).toContain("GitHub");
		expect(
			container.querySelector('input[aria-label="Search connectors"]'),
		).toBeNull();
		await act(async () => connectorFilter()?.click());
		expect(connectorFilter()?.getAttribute("aria-pressed")).toBe("true");
		const input = container.querySelector(
			'input[aria-label="Search marketplace"]',
		) as HTMLInputElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(input, "GitHub");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(container.textContent).toContain("GitHub");
		expect(container.textContent).not.toContain("Gmail");
		await act(async () =>
			[...container.querySelectorAll("button")]
				.find((button) => button.textContent === "Install")
				?.click(),
		);
		expect(mocks.connect).toHaveBeenCalledWith("github");
		await act(async () =>
			[...container.querySelectorAll("button")]
				.find((button) => button.textContent?.startsWith("Skills"))
				?.click(),
		);
		expect(
			container.querySelector('section[aria-label="Connectors"]'),
		).toBeNull();
		await act(async () => connectorFilter()?.click());
		expect(container.textContent).toContain("GitHub");
	});

	it("keeps connectors usable when the separate marketplace catalog fails", async () => {
		mocks.marketplace.mockRejectedValue(new Error("Marketplace unavailable"));
		await render();
		await act(async () => connectorFilter()?.click());
		expect(container.textContent).toContain("Gmail");
		expect(container.textContent).not.toContain("Marketplace unavailable");
	});
});
