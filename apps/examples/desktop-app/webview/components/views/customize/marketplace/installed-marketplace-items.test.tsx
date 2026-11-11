// @vitest-environment jsdom
import { act, type ComponentProps, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceLocalInstalledItem } from "./installed-marketplace-types";

const mocks = vi.hoisted(() => ({
	catalog: vi.fn(),
	invoke: vi.fn(),
	categoryFilter: vi.fn(),
}));
vi.mock("@/lib/marketplace", () => ({
	fetchMarketplaceCatalog: mocks.catalog,
	getCachedMarketplaceCatalog: () => null,
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: () => () => {} },
	openExternalUrl: vi.fn(),
}));
vi.mock("../navigation/customize-category-filter", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../navigation/customize-category-filter")
	>()),
	useCustomizeCategoryFilter: mocks.categoryFilter,
}));

import { subscribeToExtensionInventoryInvalidation } from "@/lib/extension-inventory";
import { clearMarketplaceInstalledEntries } from "@/lib/marketplace-installed";
import type { CustomizeSearchState } from "../search/customize-search-state";
import { CustomizationCategoryNavigationProvider } from "../shared/customization-category-section";

import { InstalledMarketplaceItems } from "./installed-marketplace-items";
import { useInstalledMarketplaceItems } from "./use-installed-marketplace-items";

/** Resolves the result model first, as the Customize page does, and shows a test its summary. */
function InstalledItems({
	onSummary,
	...props
}: Omit<ComponentProps<typeof InstalledMarketplaceItems>, "model"> & {
	onSummary?: (summary: CustomizeSearchState) => void;
}) {
	const model = useInstalledMarketplaceItems(props);
	const { query, count, loading, error } = model.summary;
	useEffect(() => {
		onSummary?.({ query, count, loading, error });
	}, [onSummary, query, count, loading, error]);
	return <InstalledMarketplaceItems {...props} model={model} />;
}

const entry = {
	id: "example-server",
	type: "mcp",
	name: "Example server",
	description: "A server with setup instructions",
	tags: [],
	install: {
		command: "",
		args: ["example/server"],
		notes: "Configure the service before use.",
	},
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	clearMarketplaceInstalledEntries();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	mocks.catalog.mockReset();
	mocks.catalog.mockResolvedValue({ entries: [entry], tags: [] });
	mocks.invoke.mockReset();
	mocks.invoke.mockResolvedValue({ installedKeys: ["mcp:example-server"] });
	mocks.categoryFilter.mockReset();
	mocks.categoryFilter.mockReturnValue(null);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

async function confirmUninstall() {
	const confirm = [
		...document.querySelectorAll<HTMLButtonElement>(
			'[role="alertdialog"] button',
		),
	].find((button) => button.textContent === "Uninstall");
	expect(confirm).toBeDefined();
	await act(async () => confirm?.click());
}

describe("Installed marketplace fallback cards", () => {
	it.each([
		{ primitive: "plugin", message: "No plugins found." },
		{ primitive: "skill", message: "No skills found." },
	] as const)("links the empty $primitive state to its marketplace", async ({
		primitive,
		message,
	}) => {
		const onSelectType = vi.fn();
		mocks.catalog.mockResolvedValue({ entries: [], tags: [] });
		mocks.invoke.mockResolvedValue({ installedKeys: [] });
		await act(async () =>
			root.render(
				<CustomizationCategoryNavigationProvider
					onSelectCategory={vi.fn()}
					onSelectType={onSelectType}
				>
					<InstalledItems primitive={primitive} />
				</CustomizationCategoryNavigationProvider>,
			),
		);
		const emptyState = container.querySelector('[data-slot="empty-state"]');
		expect(emptyState?.getAttribute("data-align")).toBe("center");
		expect(
			emptyState?.querySelector('[data-slot="empty-state-description"]')
				?.textContent,
		).toBe(message);
		const browse = emptyState?.querySelector("button");
		expect(browse?.textContent).toBe("Browse customizations");
		expect(emptyState?.querySelectorAll("button")).toHaveLength(1);
		await act(async () => browse?.click());
		expect(onSelectType).toHaveBeenCalledExactlyOnceWith(primitive);
	});

	it.each([
		{ type: "plugin", label: "plugin", source: "card" },
		{ type: "plugin", label: "plugin", source: "details" },
		{ type: "mcp", label: "MCP server", source: "card" },
		{ type: "mcp", label: "MCP server", source: "details" },
		{ type: "skill", label: "skill", source: "details" },
	] as const)("confirms $type uninstall from the $source and leaves it installed when canceled", async ({
		type,
		label,
		source,
	}) => {
		const customization = { ...entry, type, name: `Example ${type}` };
		mocks.catalog.mockResolvedValue({ entries: [customization], tags: [] });
		mocks.invoke.mockImplementation(async (command: string) =>
			command === "uninstall_marketplace_entry"
				? { status: "uninstalled", message: "Removed." }
				: { installedKeys: [`${type}:example-server`] },
		);
		await act(async () => root.render(<InstalledItems primitive={type} />));
		if (source === "details") {
			await act(async () =>
				container
					.querySelector<HTMLButtonElement>(
						`button[aria-label="View ${customization.name} details"]`,
					)
					?.click(),
			);
		}
		const scope =
			source === "details"
				? document.querySelector('[role="dialog"]')
				: container;
		const uninstall = [...(scope?.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent === "Uninstall",
		);
		expect(uninstall).toBeDefined();
		await act(async () => uninstall?.click());
		const confirmation = document.querySelector('[role="alertdialog"]');
		expect(confirmation?.textContent).toContain(`Uninstall ${label}?`);
		expect(confirmation?.textContent).toContain(customization.name);
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"uninstall_marketplace_entry",
			expect.anything(),
			expect.anything(),
		);
		const cancel = [...(confirmation?.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent === "Cancel",
		);
		expect(cancel).toBeDefined();
		await act(async () => cancel?.click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"uninstall_marketplace_entry",
			expect.anything(),
			expect.anything(),
		);
		await act(async () => uninstall?.click());
		await confirmUninstall();
		expect(mocks.invoke).toHaveBeenCalledWith(
			"uninstall_marketplace_entry",
			{ entry: customization },
			{ timeoutMs: type === "mcp" ? null : 300_000 },
		);
	});

	it("invalidates inventory once and notifies its owner after uninstalling", async () => {
		const onInstalledItemsChanged = vi.fn().mockResolvedValue(undefined);
		const onInvalidation = vi.fn();
		const unsubscribe =
			subscribeToExtensionInventoryInvalidation(onInvalidation);
		try {
			await act(async () =>
				root.render(
					<InstalledItems
						primitive="mcp"
						onInstalledItemsChanged={onInstalledItemsChanged}
					/>,
				),
			);
			mocks.invoke.mockImplementation(async (command: string) =>
				command === "uninstall_marketplace_entry"
					? { status: "uninstalled", message: "Removed." }
					: { installedKeys: [] },
			);
			await act(async () => {
				[...container.querySelectorAll("button")]
					.find((button) => button.textContent === "Uninstall")
					?.click();
			});
			await confirmUninstall();
			expect(onInvalidation).toHaveBeenCalledTimes(1);
			expect(onInstalledItemsChanged).toHaveBeenCalledTimes(1);
			expect(container.querySelector('[data-slot="item-card"]')).toBeNull();
		} finally {
			unsubscribe();
		}
	});

	it("opens installed MCP details while keeping its uninstall action separate", async () => {
		const onOpenMcp = vi.fn();
		const onOpenSkill = vi.fn();
		await act(async () =>
			root.render(
				<InstalledItems
					primitive="mcp"
					onOpenMcp={onOpenMcp}
					onOpenSkill={onOpenSkill}
				/>,
			),
		);
		const detailsButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="View Example server details"]',
		);
		expect(detailsButton).not.toBeNull();
		expect(detailsButton?.hasAttribute("aria-expanded")).toBe(false);
		await act(async () => detailsButton?.click());
		expect(onOpenMcp).toHaveBeenCalledExactlyOnceWith(entry, detailsButton);
		expect(onOpenSkill).not.toHaveBeenCalled();
		expect(
			container.querySelector("[data-marketplace-entry-details]"),
		).toBeNull();
		onOpenMcp.mockClear();
		mocks.invoke.mockRejectedValue(new Error("Server is busy"));
		const uninstall = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Uninstall",
		);
		expect(uninstall).toBeDefined();
		await act(async () => uninstall?.click());
		await confirmUninstall();
		expect(mocks.invoke).toHaveBeenCalledWith(
			"uninstall_marketplace_entry",
			{ entry },
			{ timeoutMs: null },
		);
		expect(onOpenMcp).not.toHaveBeenCalled();
		expect(onOpenSkill).not.toHaveBeenCalled();
		expect(container.textContent).not.toContain("Server is busy");
		expect(
			document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
		).toBe("Server is busy");
		expect(
			container.querySelector("[data-marketplace-entry-details]"),
		).toBeNull();
	});

	it("opens installed skill details without enabling a toggle for unknown local files", async () => {
		const skill = {
			...entry,
			id: "example-skill",
			type: "skill",
			name: "Example skill",
			tagline: "A concise skill summary",
			author: { name: "Skill author" },
			verified: true,
		};
		const onOpenSkill = vi.fn();
		mocks.catalog.mockResolvedValue({ entries: [skill], tags: [] });
		mocks.invoke.mockResolvedValue({ installedKeys: ["skill:example-skill"] });
		await act(async () =>
			root.render(
				<InstalledItems primitive="skill" onOpenSkill={onOpenSkill} />,
			),
		);
		const detailsButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="View Example skill details"]',
		);
		expect(detailsButton).not.toBeNull();
		expect(detailsButton?.hasAttribute("aria-expanded")).toBe(false);
		expect(container.textContent).toContain(skill.tagline);
		expect(container.textContent).toContain("By Skill author");
		expect(container.querySelector('[aria-label="Verified"]')).not.toBeNull();
		expect(container.textContent).not.toContain(skill.description);
		await act(async () => detailsButton?.click());
		expect(onOpenSkill).toHaveBeenCalledExactlyOnceWith(skill, detailsButton);
		expect(
			container.querySelector("[data-marketplace-entry-details]"),
		).toBeNull();
		onOpenSkill.mockClear();
		mocks.invoke.mockClear();
		const toggle = container.querySelector<HTMLInputElement>(
			'[role="switch"][aria-label="Enable Example skill"]',
		);
		expect(toggle?.checked).toBe(true);
		expect(toggle?.disabled).toBe(true);
		expect(toggle?.title).toContain("local files");
		await act(async () => toggle?.click());
		const uninstall = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Uninstall",
		);
		expect(uninstall).toBeUndefined();
		expect(mocks.invoke).not.toHaveBeenCalled();
		expect(onOpenSkill).not.toHaveBeenCalled();
		expect(
			container.querySelector("[data-marketplace-entry-details]"),
		).toBeNull();
	});

	it("lets the inventory owner replace the installed heading without hiding its cards", async () => {
		const render = (showInstalledHeading: boolean) =>
			act(async () =>
				root.render(
					<InstalledItems
						primitive="mcp"
						showInstalledHeading={showInstalledHeading}
					/>,
				),
			);
		await render(true);
		expect(
			container.querySelector('[data-slot="section-heading-title"]')
				?.textContent,
		).toBe("Installed");
		expect(
			container.querySelector('[data-slot="section-heading-count"]')
				?.textContent,
		).toBe("1");
		await render(false);
		expect(container.querySelector('[data-slot="section-heading"]')).toBeNull();
		expect(
			container.querySelector('[aria-label="View Example server details"]'),
		).not.toBeNull();
	});
	it("selects a fallback detail category and closes the dialog", async () => {
		const category = { id: "development", label: "Development" };
		const setCategory = vi.fn();
		mocks.categoryFilter.mockReturnValue({
			category: null,
			categories: [category],
			setCategory,
		});
		mocks.catalog.mockResolvedValue({
			entries: [{ ...entry, tags: ["development"] }],
			tags: [category],
		});
		await act(async () => root.render(<InstalledItems primitive="mcp" />));
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="View Example server details"]',
				)
				?.click(),
		);
		const categoryButton = document.querySelector<HTMLButtonElement>(
			'[role="dialog"] button[title="Filter by Development"]',
		);
		expect(categoryButton).not.toBeNull();
		await act(async () => categoryButton?.click());
		expect(setCategory).toHaveBeenCalledExactlyOnceWith(category);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("opens setup guidance in a dialog without expanding the card", async () => {
		const onOpenSkill = vi.fn();
		await act(async () =>
			root.render(<InstalledItems primitive="mcp" onOpenSkill={onOpenSkill} />),
		);
		const card = container.querySelector('[data-slot="item-card"]');
		const originalCard = card?.innerHTML;
		const trigger = card?.querySelector<HTMLButtonElement>(
			'button[aria-label="View Example server details"]',
		);
		expect(trigger).not.toBeNull();
		expect(trigger?.hasAttribute("aria-expanded")).toBe(false);
		expect(card?.querySelector('[data-slot="item-card-content"]')).toBeNull();
		trigger?.focus();
		await act(async () => trigger?.click());
		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain("Configure the service before use.");
		expect(card?.innerHTML).toBe(originalCard);
		const uninstall = [...(dialog?.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent === "Uninstall",
		);
		expect(uninstall).toBeDefined();
		let rejectUninstall: (error: Error) => void = () => {};
		mocks.invoke.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectUninstall = reject;
			}),
		);
		await act(async () => uninstall?.click());
		await confirmUninstall();
		expect(mocks.invoke).toHaveBeenCalledWith(
			"uninstall_marketplace_entry",
			{ entry },
			{ timeoutMs: null },
		);
		expect(uninstall?.disabled).toBe(true);
		await act(async () => rejectUninstall(new Error("Server is busy")));
		expect(uninstall?.disabled).toBe(false);
		expect(dialog?.querySelector('[role="alert"]')?.textContent).toBe(
			"Server is busy",
		);
		expect(
			card?.querySelector('[data-slot="item-card-actions"] output')
				?.textContent,
		).toBe("Uninstall failed");
		expect(card?.textContent).not.toContain("Server is busy");
		expect(
			card?.querySelector('[data-slot="item-card-actions"] button'),
		).toBeNull();
		await act(async () =>
			dialog?.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click(),
		);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(
			card?.querySelector('[data-slot="item-card-actions"] output')
				?.textContent,
		).toBe("Uninstall failed");
		await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(onOpenSkill).not.toHaveBeenCalled();
		await act(async () => trigger?.click());
		const retryDialog = document.querySelector('[role="dialog"]');
		const retry = [...(retryDialog?.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent === "Uninstall",
		);
		expect(retry).toBeDefined();
		mocks.invoke.mockImplementation(async (command: string) =>
			command === "uninstall_marketplace_entry"
				? { status: "uninstalled", message: "Removed on retry." }
				: { installedKeys: [] },
		);
		await act(async () => retry?.click());
		await confirmUninstall();
		expect(container.querySelector('[data-slot="item-card"]')).toBeNull();
		expect(retryDialog?.querySelector('[role="alert"]')).toBeNull();
	});
});

describe("Integrated Customize search", () => {
	it("searches installed marketplace entries by the same author metadata as Browse", async () => {
		mocks.catalog.mockResolvedValue({
			entries: [{ ...entry, author: { name: "Example Author" } }],
			tags: [],
		});
		const onSummary = vi.fn();
		await act(async () =>
			root.render(
				<InstalledItems
					primitive="mcp"
					searchQuery="  EXAMPLE AUTHOR  "
					searchResults
					onSummary={onSummary}
				/>,
			),
		);
		expect(container.textContent).toContain("Example server");
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "example author",
			count: 1,
			loading: false,
			error: false,
		});
	});

	function localItem(
		key: string,
		matchValues: string[],
		searchText: string[] = [],
	): MarketplaceLocalInstalledItem {
		return {
			key,
			matchValues,
			searchText,
			render: ({ matchedEntries = [] } = {}) => (
				<div data-local-item={key} key={key}>
					{key}
					<span>
						{matchedEntries.map((matched) => matched.name).join(", ")}
					</span>
				</div>
			),
		};
	}

	it("filters installed catalog and local cards without disturbing marketplace reconciliation", async () => {
		const fallback = {
			...entry,
			id: "fallback-server",
			name: "Fallback server",
			tags: ["productivity"],
			install: { ...entry.install, args: ["fallback/server"] },
		};
		mocks.catalog.mockResolvedValue({
			entries: [{ ...entry, tags: ["development"] }, fallback],
			tags: [],
		});
		mocks.invoke.mockResolvedValue({
			installedKeys: ["mcp:example-server", "mcp:fallback-server"],
		});
		const installedItems = [
			localItem("Local server", ["example-server"]),
			localItem("Uncategorized server", ["unrelated"]),
		];
		const onSummary = vi.fn();
		const render = async (category: string | null, searchResults = false) => {
			mocks.categoryFilter.mockReturnValue({
				category: category ? { id: category, label: category } : null,
				categories: [],
				setCategory: vi.fn(),
			});
			await act(async () =>
				root.render(
					<InstalledItems
						installedItems={installedItems}
						onSummary={onSummary}
						primitive="mcp"
						searchQuery=""
						searchResults={searchResults}
					/>,
				),
			);
		};

		await render("development");
		expect(container.querySelectorAll("[data-local-item]")).toHaveLength(1);
		expect(container.textContent).toContain("Local serverExample server");
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			0,
		);
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "",
			count: 1,
			loading: false,
			error: false,
		});

		await render("productivity");
		expect(container.querySelectorAll("[data-local-item]")).toHaveLength(0);
		expect(container.textContent).toContain("Fallback server");
		expect(container.textContent).not.toContain("Example server");
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			1,
		);

		await render("unmatched");
		expect(container.textContent).toContain(
			"No MCP servers found in unmatched.",
		);
		expect(container.querySelectorAll("[data-local-item]")).toHaveLength(0);
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			0,
		);

		for (const [category, searchResults] of [
			[null, false],
			["development", true],
		] as const) {
			await render(category, searchResults);
			expect(container.querySelectorAll("[data-local-item]")).toHaveLength(2);
			expect(
				container.querySelectorAll('[data-slot="item-card"]'),
			).toHaveLength(1);
			expect(onSummary).toHaveBeenLastCalledWith({
				query: "",
				count: 3,
				loading: false,
				error: false,
			});
		}
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
	});

	it("uses the controlled query and searches descriptions without adding deduplication matches", async () => {
		const onSummary = vi.fn();
		const installedItems = [
			localItem(
				"Local helper",
				["local-helper"],
				["Example server automation"],
			),
		];
		const render = (searchQuery: string) =>
			root.render(
				<InstalledItems
					installedItems={installedItems}
					onSummary={onSummary}
					primitive="mcp"
					searchQuery={searchQuery}
					searchResults
				/>,
			);
		await act(async () => render("  EXAMPLE SERVER  "));
		expect(container.querySelector("input")).toBeNull();
		expect(container.querySelector("h1, h2")).toBeNull();
		expect(container.querySelectorAll("[data-local-item]")).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			1,
		);
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "example server",
			count: 2,
			loading: false,
			error: false,
		});

		await act(async () => render("automation"));
		expect(container.querySelectorAll("[data-local-item]")).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			0,
		);
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "automation",
			count: 1,
			loading: false,
			error: false,
		});

		await act(async () => render("no matching item"));
		expect(container.textContent).toBe("");
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "no matching item",
			count: 0,
			loading: false,
			error: false,
		});
	});

	it("keeps local results visible while the catalog is loading and after it fails", async () => {
		let rejectCatalog: (error: Error) => void = () => {};
		mocks.catalog.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectCatalog = reject;
			}),
		);
		const onSummary = vi.fn();
		await act(async () =>
			root.render(
				<InstalledItems
					installedItems={[
						localItem("Local helper", ["helper"], ["Local automation"]),
						localItem("Other tool", ["other"]),
					]}
					onSummary={onSummary}
					primitive="mcp"
					searchQuery="automation"
					searchResults
				/>,
			),
		);
		expect(container.textContent).toBe("Local helper");
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "automation",
			count: 1,
			loading: true,
			error: false,
		});
		await act(async () => rejectCatalog(new Error("Marketplace unavailable")));
		expect(
			container.querySelector('[data-local-item="Local helper"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-local-item="Other tool"]'),
		).toBeNull();
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Marketplace unavailable",
		);
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "automation",
			count: 1,
			loading: false,
			error: true,
		});
	});

	it("searches matched marketplace metadata once and recomputes when local items refresh", async () => {
		const onSummary = vi.fn();
		const render = (installedItems: MarketplaceLocalInstalledItem[]) =>
			root.render(
				<InstalledItems
					installedItems={installedItems}
					onSummary={onSummary}
					primitive="mcp"
					searchQuery="setup instructions"
					searchResults
				/>,
			);
		await act(async () =>
			render([localItem("Local server", ["example-server"])]),
		);
		expect(container.querySelectorAll("[data-local-item]")).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			0,
		);
		expect(container.textContent).toContain("Local serverExample server");
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "setup instructions",
			count: 1,
			loading: false,
			error: false,
		});

		await act(async () =>
			render([localItem("Renamed server", ["example-server"])]),
		);
		expect(container.textContent).toContain("Renamed serverExample server");
		expect(container.textContent).not.toContain("Local server");
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			0,
		);
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
	});

	it("retains local results and reports a partial failure when installed status fails", async () => {
		mocks.invoke.mockRejectedValue(new Error("Status unavailable"));
		const onSummary = vi.fn();
		await act(async () =>
			root.render(
				<InstalledItems
					installedItems={[localItem("Local server", ["example-server"])]}
					onSummary={onSummary}
					primitive="mcp"
					searchQuery="server"
					searchResults
				/>,
			),
		);
		expect(container.querySelectorAll("[data-local-item]")).toHaveLength(1);
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Unable to check installed marketplace entries",
		);
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "server",
			count: 1,
			loading: false,
			error: true,
		});
	});
});
