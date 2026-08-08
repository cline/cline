// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceCatalog, MarketplaceEntry } from "@/lib/marketplace";
import { MarketplaceView } from "./marketplace-view";

const { fetchMarketplaceCatalogMock, invokeMock } = vi.hoisted(() => ({
	fetchMarketplaceCatalogMock: vi.fn(),
	invokeMock: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
	openExternalUrl: vi.fn(),
}));

vi.mock("@/lib/marketplace", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/marketplace")>();
	return {
		...original,
		fetchMarketplaceCatalog: fetchMarketplaceCatalogMock,
	};
});

const githubEntry: MarketplaceEntry = {
	id: "github",
	type: "mcp",
	name: "GitHub",
	featured: true,
	tagline: "GitHub tools",
	description: "Official GitHub MCP server",
	tags: [],
	install: {
		args: [
			"github",
			"--transport",
			"http",
			"https://api.githubcopilot.com/mcp/",
		],
		command:
			"cline mcp install github --transport http https://api.githubcopilot.com/mcp/",
	},
};

const catalog: MarketplaceCatalog = {
	version: 1,
	counts: { total: 1, mcps: 1, plugins: 0, skills: 0 },
	tags: [],
	entries: [githubEntry],
};

describe("MarketplaceView install lifecycle", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		fetchMarketplaceCatalogMock.mockReset().mockResolvedValue(catalog);
		invokeMock.mockReset().mockImplementation(async (command: string) => {
			if (command === "list_marketplace_installed_entries") {
				return { installedKeys: [] };
			}
			if (command === "install_marketplace_entry") {
				return {
					status: "installed",
					message: "Installed GitHub.",
				};
			}
			throw new Error(`Unexpected command: ${command}`);
		});
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.restoreAllMocks();
	});

	it("refreshes local items after an install", async () => {
		const lifecycle: string[] = [];
		await act(async () => {
			root.render(
				<MarketplaceView
					onInstalledItemsChanged={() => {
						lifecycle.push("refreshed");
					}}
					primitive="mcp"
				/>,
			);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("GitHub");
			expect(container.textContent).toContain("Install");
		});
		const installButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Install",
		);
		if (!installButton) {
			throw new Error("Install button not found");
		}

		await act(async () => {
			installButton.click();
		});

		await vi.waitFor(() => {
			expect(lifecycle).toEqual(["refreshed"]);
		});
		expect(invokeMock).toHaveBeenCalledWith(
			"install_marketplace_entry",
			{ entry: githubEntry },
			{ timeoutMs: 300_000 },
		);
	});

	it("omits entries reserved for a first-party pinned card", async () => {
		await act(async () => {
			root.render(
				<MarketplaceView excludedEntryKeys={["mcp:github"]} primitive="mcp" />,
			);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("No MCP servers installed.");
			expect(container.textContent).toContain(
				"No MCP servers match the current filters.",
			);
		});
		expect(container.textContent).not.toContain("GitHub");
		expect(container.querySelector('button[type="button"]')).toBeNull();
	});

	it("renders featured content directly below search", async () => {
		await act(async () => {
			root.render(
				<MarketplaceView
					chrome="embedded"
					featuredContent={<div data-testid="featured">Featured MCP</div>}
					primitive="mcp"
				/>,
			);
		});

		const search = await vi.waitFor(() => {
			const element = container.querySelector(
				'[aria-label="Search MCP Servers"]',
			);
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		const featured = container.querySelector('[data-testid="featured"]');
		const installedHeading = Array.from(container.querySelectorAll("h2")).find(
			(heading) => heading.textContent === "Installed",
		);
		if (!featured || !installedHeading) {
			throw new Error("Expected featured content and installed section");
		}
		expect(
			search.compareDocumentPosition(featured) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).not.toBe(0);
		expect(
			featured.compareDocumentPosition(installedHeading) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).not.toBe(0);
	});
});
