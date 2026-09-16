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
const intersections = new Set<() => void>();
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
	intersections.clear();
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			callback: () => void;
			constructor(callback: IntersectionObserverCallback) {
				this.callback = () =>
					callback(
						[{ isIntersecting: true } as IntersectionObserverEntry],
						this as unknown as IntersectionObserver,
					);
			}
			observe() {
				intersections.add(this.callback);
			}
			disconnect() {
				intersections.delete(this.callback);
			}
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
	it("shows the shared marketplace rows in All and the Connectors filter, with marketplace search and install", async () => {
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
		expect(
			container.querySelector('section[aria-label="Connectors"]')?.textContent,
		).not.toContain("Install");
		await act(async () =>
			[...container.querySelectorAll("button")]
				.find((button) => button.textContent === "GitHub")
				?.click(),
		);
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"GitHub",
		);
		await act(async () =>
			[...document.querySelectorAll("button")]
				.find((button) => button.textContent === "Install")
				?.click(),
		);
		expect(mocks.connect).toHaveBeenCalledWith("github");
		await act(async () =>
			(
				document.querySelector(
					'[role="dialog"] button[data-slot="dialog-close"]',
				) as HTMLButtonElement | null
			)?.click(),
		);
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
	it("shows the full catalog count instead of the preview or search-result count", async () => {
		mocks.catalog.mockResolvedValue({
			toolkits: Array.from({ length: 121 }, (_, i) => ({
				slug: `app_${i}`,
				name: `App ${i}`,
			})),
		});
		await render();
		expect(connectorFilter()?.textContent).toBe("Connectors121");
		const section = container.querySelector('section[aria-label="Connectors"]');
		expect(section?.querySelector("h2")?.textContent).toBe("Connectors121");
		expect(section?.querySelectorAll("button")).toHaveLength(24);
		const input = container.querySelector(
			'input[aria-label="Search marketplace"]',
		) as HTMLInputElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(input, "App 120");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(section?.querySelectorAll("button")).toHaveLength(1);
		expect(section?.textContent).toContain("App 120");
		expect(connectorFilter()?.textContent).toBe("Connectors121");
		expect(section?.querySelector("h2")?.textContent).toBe("Connectors121");
	});
	it("appends pages on scroll through the full catalog and resets pagination for search", async () => {
		mocks.catalog.mockResolvedValue({
			toolkits: Array.from({ length: 73 }, (_, i) => ({
				slug: `app_${i}`,
				name: `App ${i}`,
			})),
		});
		await render();
		const section = container.querySelector('section[aria-label="Connectors"]');
		expect(section?.textContent).not.toContain("search to find");
		for (const count of [48, 72, 73]) {
			await act(async () =>
				[...intersections].forEach((callback) => {
					callback();
				}),
			);
			expect(section?.querySelectorAll("button")).toHaveLength(count);
			expect(connectorFilter()?.textContent).toBe("Connectors73");
		}
		expect(intersections.size).toBe(0);
		expect(
			new Set(
				[...(section?.querySelectorAll("button") ?? [])].map(
					(button) => button.textContent,
				),
			).size,
		).toBe(73);
		const input = container.querySelector(
			'input[aria-label="Search marketplace"]',
		) as HTMLInputElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(input, "App");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(section?.querySelectorAll("button")).toHaveLength(24);
		await act(async () =>
			[...intersections].forEach((callback) => {
				callback();
			}),
		);
		expect(section?.querySelectorAll("button")).toHaveLength(48);
		expect(mocks.catalog).toHaveBeenCalledTimes(1);
	});
});
