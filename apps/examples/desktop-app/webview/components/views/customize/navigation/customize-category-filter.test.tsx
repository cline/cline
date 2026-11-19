// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MarketplaceCatalog } from "@/lib/marketplace";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), invoke: vi.fn() }));

vi.mock("@/lib/desktop-client", () => ({
	resolveDesktopBackendHttpEndpoint: async () => {
		throw new Error("No sidecar");
	},
	desktopClient: { invoke: mocks.invoke, subscribe: () => () => {} },
}));
vi.mock("@/lib/use-composio-status", () => ({
	useComposioStatus: () => ({ status: null }),
}));
vi.mock("@/lib/use-composio-catalog", () => ({
	useComposioCatalog: () => ({ catalog: null }),
}));

import { useMarketplaceDirectory } from "@/lib/use-marketplace-directory";
import {
	CustomizeCategoryFilterProvider,
	useCustomizeCategoryFilter,
} from "./customize-category-filter";

const catalog: MarketplaceCatalog = {
	version: 1,
	counts: { total: 1, plugins: 0, skills: 1, mcps: 0 },
	tags: [{ id: "developer-tools", label: "Developer tools", count: 1 }],
	entries: [
		{
			id: "debugging",
			type: "skill",
			name: "Debugging",
			tagline: "Investigate failures",
			description: "A debugging workflow",
			tags: ["developer-tools"],
			install: { command: "", args: ["example/debugging"] },
		},
	],
};

function Categories() {
	const filter = useCustomizeCategoryFilter();
	return (
		<output aria-label="Categories">
			{filter?.categories.map((category) => category.label).join(", ")}
		</output>
	);
}

function Directory({ name }: { name: string }) {
	const directory = useMarketplaceDirectory();
	return (
		<output aria-label={name} data-installed-ready={directory.installedReady}>
			{directory.errorMessage ??
				directory.catalog?.entries.map((entry) => entry.name).join(", ")}
		</output>
	);
}

function Customize({ search = false }: { search?: boolean }) {
	return (
		<CustomizeCategoryFilterProvider view="browse">
			<Categories />
			<Directory name="Browse" />
			{search ? <Directory name="Search" /> : null}
		</CustomizeCategoryFilterProvider>
	);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("fetch", mocks.fetch);
	mocks.invoke.mockResolvedValue({ installedKeys: [] });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

it("recovers categories when search retries a failed catalog without leaving Browse", async () => {
	mocks.fetch.mockRejectedValueOnce(new Error("Catalog unavailable"));
	await act(async () => root.render(<Customize />));
	expect(
		container.querySelector('[aria-label="Categories"]')?.textContent,
	).toBe("");
	expect(container.querySelector('[aria-label="Browse"]')?.textContent).toBe(
		"Catalog unavailable",
	);

	mocks.fetch.mockResolvedValueOnce(Response.json(catalog));
	let finishInventory!: (result: { installedKeys: string[] }) => void;
	mocks.invoke.mockReturnValueOnce(
		new Promise((resolve) => {
			finishInventory = resolve;
		}),
	);
	await act(async () => root.render(<Customize search />));
	expect(container.querySelector('[aria-label="Search"]')?.textContent).toBe(
		"Debugging",
	);
	for (const name of ["Browse", "Search"]) {
		expect(
			container
				.querySelector(`[aria-label="${name}"]`)
				?.getAttribute("data-installed-ready"),
		).toBe("false");
	}
	await act(async () => root.render(<Customize />));
	expect(
		container.querySelector('[aria-label="Categories"]')?.textContent,
	).toBe("Developer tools");
	expect(container.querySelector('[aria-label="Browse"]')?.textContent).toBe(
		"Debugging",
	);
	expect(mocks.fetch).toHaveBeenCalledTimes(2);
	await act(async () => finishInventory({ installedKeys: [] }));
	expect(
		container
			.querySelector('[aria-label="Browse"]')
			?.getAttribute("data-installed-ready"),
	).toBe("true");
});
