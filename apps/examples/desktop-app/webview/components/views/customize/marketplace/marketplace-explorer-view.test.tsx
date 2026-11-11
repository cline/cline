// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketplaceEntryDetailPage } from "./marketplace-entry-detail-page";

const mocks = vi.hoisted(() => ({
	configured: true,
	catalog: vi.fn(),
	marketplace: vi.fn(),
	connect: vi.fn(),
	status: vi.fn(),
	invoke: vi.fn(),
	subscribe: vi.fn(),
	settingsListeners: new Set<() => void>(),
	integrations: [] as { toolkit: string; status: string }[],
}));

vi.mock("@/lib/use-composio-connections", () => ({
	useComposioConnections: () => ({
		configured: mocks.configured,
		status: { integrations: mocks.integrations },
		statusBySlug: new Map(
			mocks.integrations.map((entry) => [entry.toolkit, entry]),
		),
		refresh: vi.fn(),
		connect: mocks.connect,
	}),
}));
vi.mock("@/lib/marketplace", () => ({
	fetchMarketplaceCatalog: mocks.marketplace,
	getCachedMarketplaceCatalog: () => null,
}));
vi.mock("./marketplace-skill-preview", () => ({
	MarketplaceSkillPreview: ({ entry }: { entry: { name: string } }) => (
		<section aria-label="Skill content">{entry.name} files</section>
	),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: (
			command: string,
			args: { operation?: string },
			options?: unknown,
		) => {
			if (command === "composio_integrations") {
				if (args.operation === "listToolkits") return mocks.catalog();
				return Promise.resolve(mocks.status()).then((value) => ({
					...value,
					integrations: value.integrations ?? [],
				}));
			}
			return mocks.invoke(command, args, options);
		},
		subscribe: mocks.subscribe,
	},
	openExternalUrl: vi.fn(),
}));

import {
	invalidateComposioCache,
	resetComposioCacheForTesting,
} from "@/lib/composio";
import {
	invalidateExtensionInventoryCache,
	subscribeToExtensionInventoryInvalidation,
} from "@/lib/extension-inventory";
import type { MarketplaceEntry } from "@/lib/marketplace";
import { clearMarketplaceInstalledEntries } from "@/lib/marketplace-installed";
import { MarketplaceActionsProvider } from "@/lib/use-marketplace-directory";
import type { CustomizeSearchState } from "../search/customize-search-state";
import { MarketplaceExplorerView } from "./marketplace-explorer-view";
import { MarketplaceResults } from "./marketplace-results";
import type { MarketplaceTypeFilter } from "./marketplace-type-meta";
import { useMarketplaceResults } from "./use-marketplace-results";

type OpenDetail = (
	entry: MarketplaceEntry,
	trigger?: HTMLButtonElement,
) => void;
type MarketplaceHostProps = {
	/** The category Browse starts on; the host owns the selection from then on. */
	initialTypeFilter?: MarketplaceTypeFilter | null;
	/** Pins the category, for a parent that decides for itself whether to follow a request. */
	typeFilter?: MarketplaceTypeFilter | null;
	onTypeFilterChange?: (filter: MarketplaceTypeFilter | null) => void;
	/** Render the search results for `searchQuery` instead of Browse. */
	searchResults?: boolean;
	searchQuery?: string;
	onOpenDetail?: OpenDetail;
	onCreateMcp?: (trigger?: HTMLButtonElement) => void;
	/** Search only: the summary the Customize page combines with installed results. */
	onSummary?: (summary: CustomizeSearchState) => void;
};

function BrowseHost({
	initialTypeFilter = null,
	typeFilter,
	onTypeFilterChange,
	onOpenDetail,
	onCreateMcp = () => {},
}: MarketplaceHostProps & { onOpenDetail: OpenDetail }) {
	const [selected, setSelected] = useState(initialTypeFilter);
	return (
		<MarketplaceExplorerView
			typeFilter={typeFilter === undefined ? selected : typeFilter}
			onTypeFilterChange={(filter) => {
				setSelected(filter);
				onTypeFilterChange?.(filter);
			}}
			onOpenDetail={onOpenDetail}
			onCreateMcp={onCreateMcp}
		/>
	);
}

function SearchHost({
	searchQuery,
	onOpenDetail,
	onSummary,
}: MarketplaceHostProps & { onOpenDetail: OpenDetail }) {
	const model = useMarketplaceResults({
		searchQuery,
		searchResults: true,
		onOpenDetail,
	});
	const { query, count, loading, error } = model.summary;
	useEffect(() => {
		onSummary?.({ query, count, loading, error });
	}, [onSummary, query, count, loading, error]);
	return <MarketplaceResults model={model} />;
}

/**
 * Stands in for the Customize page: it owns Browse's category and shows the
 * detail page a card opens, unless a test supplies its own handlers.
 */
function MarketplaceHost(props: MarketplaceHostProps) {
	const [detailEntry, setDetailEntry] = useState<MarketplaceEntry | null>(null);
	const onOpenDetail = props.onOpenDetail ?? setDetailEntry;
	const Results = props.searchResults ? SearchHost : BrowseHost;
	return (
		// Results and the detail page share each entry's install progress.
		<MarketplaceActionsProvider>
			<div hidden={detailEntry !== null}>
				<Results {...props} onOpenDetail={onOpenDetail} />
			</div>
			{detailEntry ? (
				<MarketplaceEntryDetailPage
					entry={detailEntry}
					onBack={() => setDetailEntry(null)}
				/>
			) : null}
		</MarketplaceActionsProvider>
	);
}

let container: HTMLDivElement;
let root: Root;
const intersections = new Set<() => void>();
beforeEach(() => {
	resetComposioCacheForTesting();
	clearMarketplaceInstalledEntries();
	invalidateExtensionInventoryCache();
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
	mocks.integrations = [];
	mocks.subscribe.mockReset();
	mocks.subscribe.mockImplementation((_event: string, listener: () => void) => {
		mocks.settingsListeners.add(listener);
		return () => {
			mocks.settingsListeners.delete(listener);
		};
	});
	mocks.invoke.mockReset();
	mocks.invoke.mockResolvedValue({ installedKeys: [] });
	mocks.status.mockReset();
	mocks.status.mockImplementation(async () => ({
		configured: mocks.configured,
		integrations: mocks.integrations,
	}));
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
	resetComposioCacheForTesting();
	container.remove();
	vi.unstubAllGlobals();
});
async function render(props: MarketplaceHostProps = {}) {
	await act(async () => root.render(<MarketplaceHost {...props} />));
}
function connectorFilter() {
	return [
		...container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
	].find((button) => button.textContent?.trim().startsWith("Connectors"));
}

function sectionHeading(title: string) {
	return [
		...container.querySelectorAll<HTMLElement>(
			'[data-slot="section-heading-title"]',
		),
	].find((heading) => heading.textContent === title);
}

const exampleSkill = {
	id: "example-skill",
	type: "skill" as const,
	name: "Example skill",
	tagline: "A workflow",
	description: "Skill description",
	tags: [],
	install: { args: ["example/skill"], command: "" },
};

const exampleMcp = {
	id: "example-mcp",
	type: "mcp" as const,
	name: "Example server",
	tagline: "A server",
	description: "Server description",
	tags: [],
	install: {
		args: ["example/server"],
		command: "",
		notes: "Configure the service before use.",
		env: [{ name: "EXAMPLE_API_KEY", description: "Your service key" }],
	},
};

const examplePlugin = {
	id: "example-plugin",
	type: "plugin" as const,
	name: "Example plugin",
	tagline: "A plugin bundle",
	description: "Plugin description",
	tags: [],
	install: {
		args: ["example/plugin"],
		command: "",
		notes: "Configure the plugin before use.",
		env: [{ name: "EXAMPLE_API_KEY", description: "Your service key" }],
	},
};

/** The card's inline Install; the detail page has an Install of its own. */
function addSkillButton() {
	return container.querySelector<HTMLButtonElement>(
		'[data-slot="item-card"] button[aria-label="Install Example skill"]',
	);
}

/** The detail page the host opens for a catalog entry. */
function detailPage() {
	const page = container
		.querySelector('[aria-label="Back to Browse"]')
		?.closest("nav")?.parentElement;
	if (!page) throw new Error("Expected the entry's detail page");
	return page;
}

function addMcpServerButton() {
	return [
		...(sectionHeading("MCP servers")
			?.closest('[data-slot="section-heading"]')
			?.querySelectorAll<HTMLButtonElement>("button") ?? []),
	].find((button) => button.textContent?.trim() === "Add MCP server");
}

async function confirmUninstall() {
	const confirm = [
		...document.querySelectorAll<HTMLButtonElement>(
			'[role="alertdialog"] button',
		),
	].find((button) => button.textContent === "Uninstall");
	expect(confirm).toBeDefined();
	await act(async () => confirm?.click());
}

describe("Marketplace directory", () => {
	it("discovers new connectors after an empty result renderer is unmounted", async () => {
		mocks.catalog.mockResolvedValue({ configured: true, toolkits: [] });
		await render();
		expect(
			container.querySelector('section[aria-label="Connectors"]'),
		).toBeNull();
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [{ slug: "github", name: "GitHub" }],
		});
		await act(async () => invalidateComposioCache());
		expect(
			container.querySelector('section[aria-label="Connectors"]')?.textContent,
		).toContain("GitHub");
	});

	it("offers manual MCP creation in Browse headings alongside View all, but not in search", async () => {
		mocks.marketplace.mockResolvedValue({ tags: [], entries: [exampleMcp] });
		const onTypeFilterChange = vi.fn();
		await render({ onTypeFilterChange });
		expect(addMcpServerButton()).toBeDefined();
		const viewAll = [
			...(sectionHeading("MCP servers")
				?.closest('[data-slot="section-heading"]')
				?.querySelectorAll<HTMLButtonElement>("button") ?? []),
		].find((button) => button.textContent?.trim() === "View all");
		expect(viewAll).toBeDefined();
		await act(async () => viewAll?.click());
		expect(onTypeFilterChange).toHaveBeenLastCalledWith("mcp");
		expect(addMcpServerButton()).toBeDefined();
		expect(container.textContent).not.toContain("View all");
		expect(mocks.invoke).not.toHaveBeenCalledWith("list_mcp_servers");
		await render({ searchResults: true, searchQuery: "example" });
		expect(container.textContent).toContain("Example server");
		expect(container.textContent).not.toContain("Add MCP server");
	});

	it.each([
		"loading",
		"empty",
		"error",
	])("keeps manual creation available when the selected MCP catalog is %s", async (state) => {
		const onCreateMcp = vi.fn();
		if (state === "loading")
			mocks.marketplace.mockReturnValue(new Promise(() => {}));
		if (state === "error")
			mocks.marketplace.mockRejectedValue(new Error("Marketplace unavailable"));
		await render({ typeFilter: "mcp", onCreateMcp });
		expect(addMcpServerButton()).toBeDefined();
		expect(addMcpServerButton()?.disabled).toBe(false);
		await act(async () => addMcpServerButton()?.click());
		expect(onCreateMcp).toHaveBeenCalledExactlyOnceWith(addMcpServerButton());
		const heading = sectionHeading("MCP servers")?.closest(
			'[data-slot="section-heading"]',
		);
		expect(
			heading?.querySelector('[data-slot="section-heading-count"]')
				?.textContent,
		).toBe(state === "empty" ? "0" : undefined);
		expect(container.textContent).toContain(
			state === "loading"
				? "Loading marketplace…"
				: state === "error"
					? "Marketplace unavailable"
					: "No entries match the current filters.",
		);
	});

	it("opens manual server creation through page navigation without loading inventory", async () => {
		const onCreateMcp = vi.fn();
		await render({ typeFilter: "mcp", onCreateMcp });
		const trigger = addMcpServerButton();
		expect(trigger).toBeDefined();
		await act(async () => trigger?.click());
		expect(onCreateMcp).toHaveBeenCalledExactlyOnceWith(trigger);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(mocks.invoke).not.toHaveBeenCalledWith("list_mcp_servers");
		expect(
			mocks.invoke.mock.calls.some(
				([command]) => command === "upsert_mcp_server",
			),
		).toBe(false);
	});

	it("adds a Browse entry without opening details, reports progress, and delegates installed details", async () => {
		mocks.marketplace.mockResolvedValue({ tags: [], entries: [exampleSkill] });
		let finishInstall: (result: { status: string; message: string }) => void =
			() => {};
		mocks.invoke.mockImplementation((command: string) => {
			if (command === "install_marketplace_entry") {
				return new Promise((resolve) => {
					finishInstall = resolve;
				});
			}
			return Promise.resolve({ installedKeys: [] });
		});
		const onOpenDetail = vi.fn();
		await render({ typeFilter: "skill", onOpenDetail });
		expect(addSkillButton()?.textContent).toBe("Install");
		await act(async () => addSkillButton()?.click());
		expect(mocks.invoke).toHaveBeenCalledWith(
			"install_marketplace_entry",
			{ entry: exampleSkill },
			{ timeoutMs: 300_000 },
		);
		expect(addSkillButton()?.disabled).toBe(true);
		expect(addSkillButton()?.textContent).toBe("Installing…");
		expect(onOpenDetail).not.toHaveBeenCalled();
		expect(
			container.querySelector('section[aria-label="Skill content"]'),
		).toBeNull();
		await act(async () => addSkillButton()?.click());
		expect(
			mocks.invoke.mock.calls.filter(
				([command]) => command === "install_marketplace_entry",
			),
		).toHaveLength(1);
		await act(async () =>
			finishInstall({ status: "installed", message: "Skill added." }),
		);
		expect(addSkillButton()).toBeNull();
		expect(container.textContent).toContain("Installed");
		expect(container.textContent).not.toContain("Skill added.");
		const trigger = container.querySelector<HTMLButtonElement>(
			'button[aria-label="View Example skill details"]',
		);
		await act(async () => trigger?.click());
		expect(onOpenDetail).toHaveBeenCalledExactlyOnceWith(exampleSkill, trigger);
	});

	it("disables inline Add until installed status is known", async () => {
		mocks.marketplace.mockResolvedValue({ tags: [], entries: [exampleSkill] });
		let resolveStatus: (result: { installedKeys: string[] }) => void = () => {};
		mocks.invoke.mockReturnValue(
			new Promise((resolve) => {
				resolveStatus = resolve;
			}),
		);
		await render({ typeFilter: "skill" });
		expect(addSkillButton()?.disabled).toBe(true);
		expect(addSkillButton()?.textContent).toBe("Checking…");
		await act(async () => addSkillButton()?.click());
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
		await act(async () =>
			resolveStatus({ installedKeys: ["skill:example-skill"] }),
		);
		expect(addSkillButton()).toBeNull();
		expect(container.textContent).toContain("Installed");
	});

	it("shows install errors and retry in details without growing the card", async () => {
		mocks.marketplace.mockResolvedValue({ tags: [], entries: [exampleSkill] });
		mocks.invoke.mockImplementation((command: string) =>
			command === "install_marketplace_entry"
				? Promise.reject(new Error("Skill source unavailable"))
				: Promise.resolve({ installedKeys: [] }),
		);
		await render({ typeFilter: "skill" });
		const card = addSkillButton()?.closest('[data-slot="item-card"]');
		await act(async () => addSkillButton()?.click());
		const details = detailPage();
		expect(details.querySelector('[role="alert"]')?.textContent).toBe(
			"Skill source unavailable",
		);
		expect(
			card?.querySelector('[data-slot="item-card-actions"] output')
				?.textContent,
		).toBe("Install failed");
		expect(addSkillButton()).toBeNull();
		expect(
			card?.querySelector('[data-slot="item-card-actions"] button'),
		).toBeNull();
		expect(card?.textContent).not.toContain("Skill source unavailable");
		expect(card?.querySelector('[data-slot="item-card-content"]')).toBeNull();
		expect(card?.querySelector('[role="alert"]')).toBeNull();
		mocks.invoke.mockResolvedValue({
			status: "installed",
			message: "Added on retry.",
		});
		const retry = [...(details.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent === "Install",
		);
		expect(retry).toBeDefined();
		await act(async () => retry?.click());
		expect(details.querySelector('[role="alert"]')).toBeNull();
		expect(card?.textContent).toContain("Installed");
		expect(card?.textContent).not.toContain("Install failed");
		expect(card?.textContent).not.toContain("Added on retry.");
	});

	it("identifies failed uninstalls on Browse cards and keeps retry in details", async () => {
		mocks.marketplace.mockResolvedValue({ tags: [], entries: [exampleSkill] });
		mocks.invoke.mockImplementation((command: string) =>
			command === "uninstall_marketplace_entry"
				? Promise.reject(new Error("Skill files are busy"))
				: Promise.resolve({ installedKeys: ["skill:example-skill"] }),
		);
		await render({ typeFilter: "skill" });
		const card = container.querySelector('[data-slot="item-card"]');
		await act(async () =>
			card
				?.querySelector<HTMLButtonElement>('[data-slot="item-card-primary"]')
				?.click(),
		);
		const details = detailPage();
		const uninstall = [...(details.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent === "Uninstall",
		);
		expect(uninstall).toBeDefined();
		await act(async () => uninstall?.click());
		await confirmUninstall();
		expect(
			card?.querySelector('[data-slot="item-card-actions"] output')
				?.textContent,
		).toBe("Uninstall failed");
		expect(
			card?.querySelector('[data-slot="item-card-actions"] button'),
		).toBeNull();
		expect(details.querySelector('[role="alert"]')?.textContent).toBe(
			"Skill files are busy",
		);
		expect(uninstall?.disabled).toBe(false);
		mocks.invoke.mockImplementation(async (command: string) =>
			command === "uninstall_marketplace_entry"
				? { status: "uninstalled", message: "Removed on retry." }
				: { installedKeys: [] },
		);
		await act(async () => uninstall?.click());
		await confirmUninstall();
		expect(card?.textContent).not.toContain("Uninstall failed");
		expect(addSkillButton()?.disabled).toBe(false);
		expect(details.querySelector('[role="alert"]')).toBeNull();
	});

	it("routes an inline install failure to the existing detail page", async () => {
		mocks.marketplace.mockResolvedValue({ tags: [], entries: [exampleSkill] });
		mocks.invoke.mockImplementation((command: string) =>
			command === "install_marketplace_entry"
				? Promise.reject(new Error("Skill source unavailable"))
				: Promise.resolve({ installedKeys: [] }),
		);
		const onOpenDetail = vi.fn();
		await render({ typeFilter: "skill", onOpenDetail });
		const trigger = addSkillButton();
		const detailsTrigger = trigger
			?.closest('[data-slot="item-card"]')
			?.querySelector('[data-slot="item-card-primary"]');
		await act(async () => trigger?.click());
		expect(onOpenDetail).toHaveBeenCalledExactlyOnceWith(
			exampleSkill,
			detailsTrigger,
		);
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("connects inline without opening the connector details", async () => {
		await render({ typeFilter: "connector" });
		const github = container
			.querySelector('button[aria-label="View GitHub details"]')
			?.closest('[data-slot="item-card"]');
		const connect = [...(github?.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent === "Connect",
		);
		expect(connect).toBeDefined();
		await act(async () => connect?.click());
		expect(mocks.connect).toHaveBeenCalledWith("github");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("loads the connector catalog even when a controlled catalog category is selected", async () => {
		await render({ typeFilter: "plugin" });
		expect(connectorFilter()?.textContent).toBe("ConnectorsBeta");
		expect(mocks.catalog).toHaveBeenCalledTimes(1);
		expect(
			container.querySelector('section[aria-label="Connectors"]'),
		).toBeNull();
		await render({ typeFilter: "skill" });
		expect(connectorFilter()?.textContent).toBe("ConnectorsBeta");
		expect(mocks.catalog).toHaveBeenCalledTimes(1);
		expect(
			container.querySelector('section[aria-label="Connectors"]'),
		).toBeNull();
	});

	it("lets the parent control categories and reports clearing without changing controlled selection", async () => {
		const onTypeFilterChange = vi.fn();
		await render({
			initialTypeFilter: "mcp",
			onTypeFilterChange,
			typeFilter: "skill",
		});
		const filter = (label: string) =>
			[...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
				(button) => button.textContent?.startsWith(label),
			) as HTMLButtonElement;
		expect(filter("Skills").getAttribute("aria-checked")).toBe("true");
		expect(filter("MCP").getAttribute("aria-checked")).toBe("false");
		await act(async () => filter("Plugins").click());
		expect(onTypeFilterChange).toHaveBeenNthCalledWith(1, "plugin");
		expect(filter("Skills").getAttribute("aria-checked")).toBe("true");
		expect(filter("Plugins").getAttribute("aria-checked")).toBe("false");
		await act(async () => filter("Skills").click());
		expect(onTypeFilterChange).toHaveBeenNthCalledWith(2, null);
		expect(filter("Skills").getAttribute("aria-checked")).toBe("true");
		await render({ onTypeFilterChange, typeFilter: null });
		expect(filter("All").getAttribute("aria-checked")).toBe("true");
		await render({ onTypeFilterChange, typeFilter: "connector" });
		expect(connectorFilter()?.getAttribute("aria-checked")).toBe("true");
		expect(
			container.querySelector('section[aria-label="Connectors"]'),
		).not.toBeNull();
		expect(onTypeFilterChange).toHaveBeenCalledTimes(2);
	});

	it("keeps a controlled connector filter while availability is loading", async () => {
		let resolveStatus: (status: { configured: boolean }) => void = () => {};
		mocks.status.mockReturnValue(
			new Promise<{ configured: boolean }>((resolve) => {
				resolveStatus = resolve;
			}),
		);
		const onTypeFilterChange = vi.fn();
		await render({ onTypeFilterChange, typeFilter: "connector" });
		expect(connectorFilter()).toBeUndefined();
		expect(
			container.querySelector(
				'[aria-label="Browse categories"] [aria-checked="true"]',
			),
		).toBeNull();
		expect(onTypeFilterChange).not.toHaveBeenCalled();
		await act(async () => resolveStatus({ configured: true }));
		expect(connectorFilter()?.getAttribute("aria-checked")).toBe("true");
		expect(onTypeFilterChange).not.toHaveBeenCalled();
	});

	it("requests All only after a controlled connector filter becomes unavailable", async () => {
		let resolveStatus: (status: { configured: boolean }) => void = () => {};
		mocks.status.mockReturnValue(
			new Promise<{ configured: boolean }>((resolve) => {
				resolveStatus = resolve;
			}),
		);
		const onTypeFilterChange = vi.fn();
		await render({ onTypeFilterChange, typeFilter: "connector" });
		expect(onTypeFilterChange).not.toHaveBeenCalled();
		await act(async () => resolveStatus({ configured: false }));
		expect(onTypeFilterChange).toHaveBeenCalledExactlyOnceWith(null);
		expect(connectorFilter()).toBeUndefined();
		await render({ onTypeFilterChange, typeFilter: null });
		expect(
			container.querySelector(
				'[aria-label="Browse categories"] [aria-checked="true"]',
			)?.textContent,
		).toBe("All");
		expect(onTypeFilterChange).toHaveBeenCalledTimes(1);
	});

	it("selects one category and returns to All when its filter is toggled off", async () => {
		await render();
		const categories = container.querySelector(
			'[aria-label="Browse categories"]',
		) as HTMLElement;
		const filters = [
			...categories.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
		];
		expect(filters.map((filter) => filter.textContent)).toEqual([
			"All",
			"ConnectorsBeta",
			"Plugins",
			"Skills",
			"MCP",
		]);
		expect(filters.map((filter) => filter.dataset.customizeCategory)).toEqual([
			"all",
			"connectors",
			"plugins",
			"skills",
			"mcp",
		]);
		expect(categories.querySelector("svg")).toBeNull();
		expect(container.querySelector("input")).toBeNull();
		const all = filters[0];
		const skills = filters.find((filter) =>
			filter.textContent?.startsWith("Skills"),
		) as HTMLButtonElement;
		expect(all.getAttribute("aria-checked")).toBe("true");
		await act(async () => skills.click());
		expect(skills.getAttribute("aria-checked")).toBe("true");
		expect(all.getAttribute("aria-checked")).toBe("false");
		expect(
			container.querySelector('section[aria-label="Connectors"]'),
		).toBeNull();
		await act(async () => skills.click());
		expect(all.getAttribute("aria-checked")).toBe("true");
		expect(
			container.querySelector('section[aria-label="Connectors"]'),
		).not.toBeNull();
		await act(async () => connectorFilter()?.click());
		expect(connectorFilter()?.getAttribute("aria-checked")).toBe("true");
		await act(async () => connectorFilter()?.click());
		expect(all.getAttribute("aria-checked")).toBe("true");
		expect(categories.querySelectorAll('[aria-checked="true"]')).toHaveLength(
			1,
		);
	});

	it("opens plugin details from the Browse overview through the page host", async () => {
		mocks.marketplace.mockResolvedValue({
			tags: [],
			entries: [exampleSkill, examplePlugin],
		});
		const onOpenDetail = vi.fn();
		await render({ onOpenDetail });
		const trigger = container.querySelector<HTMLButtonElement>(
			'button[aria-label="View Example plugin details"]',
		);
		await act(async () => trigger?.click());
		expect(onOpenDetail).toHaveBeenCalledExactlyOnceWith(
			examplePlugin,
			trigger,
		);
		expect(
			container.querySelector('section[aria-label="Skill content"]'),
		).toBeNull();
		expect(
			container.querySelector('[aria-label="Browse categories"]'),
		).not.toBeNull();
		expect(
			container.querySelector(
				'button[aria-label="View Example skill details"]',
			),
		).not.toBeNull();
		expect(container.querySelector('[aria-label="Close details"]')).toBeNull();
	});

	it("hides connectors and does not fetch their catalog without beta access", async () => {
		mocks.configured = false;
		await render();
		expect(connectorFilter()).toBeUndefined();
		expect(
			[
				...container.querySelectorAll(
					'[aria-label="Browse categories"] [role="radio"]',
				),
			].map((filter) => filter.textContent),
		).toEqual(["All", "Plugins", "Skills", "MCP"]);
		expect(mocks.catalog).not.toHaveBeenCalled();
		expect(
			container.querySelector('input[aria-label="Search marketplace"]'),
		).toBeNull();
	});
	it("shows the shared marketplace rows in All and the Connectors filter, and connects from a connector's details", async () => {
		await render();
		expect(container.textContent).toContain("Gmail");
		expect(container.textContent).toContain("GitHub");
		expect(
			container.querySelector('input[aria-label="Search connectors"]'),
		).toBeNull();
		await act(async () => connectorFilter()?.click());
		expect(connectorFilter()?.getAttribute("aria-checked")).toBe("true");
		expect(container.textContent).toContain("GitHub");
		expect(
			container.querySelector('section[aria-label="Connectors"]')?.textContent,
		).not.toContain("Install");
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="View GitHub details"]',
				)
				?.click(),
		);
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"GitHub",
		);
		await act(async () =>
			[
				...document.querySelectorAll<HTMLButtonElement>(
					'[role="dialog"] button',
				),
			]
				.find((button) => button.textContent === "Connect")
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

	it("shows capped category previews with View all actions and no heading counts", async () => {
		mocks.marketplace.mockResolvedValue({
			tags: [],
			entries: [
				{ ...exampleSkill, id: "first", name: "First skill" },
				{ ...exampleSkill, id: "second", name: "Second skill" },
				...Array.from({ length: 6 }, (_, i) => ({
					...exampleSkill,
					id: `extra-${i}`,
					name: `Extra skill ${i}`,
				})),
				{
					...exampleSkill,
					id: "plugin",
					type: "plugin",
					name: "Example plugin",
				},
			],
		});
		const onTypeFilterChange = vi.fn();
		await render({ typeFilter: null, onTypeFilterChange });
		const headings = [
			...container.querySelectorAll('[data-slot="section-heading-title"]'),
		].filter((heading) => heading.textContent !== "Suggested");
		expect(
			headings.map((heading) => [
				heading.textContent,
				heading.parentElement?.querySelector(
					'[data-slot="section-heading-count"]',
				)?.textContent,
			]),
		).toEqual([
			["Connectors", undefined],
			["Plugins", undefined],
			["Skills", undefined],
		]);
		expect(
			container.querySelectorAll('[data-slot="section-heading-count"]'),
		).toHaveLength(0);
		expect(
			container.querySelectorAll(
				'button[aria-label^="Install "][aria-label*="skill"]',
			),
		).toHaveLength(6);
		for (const [index, heading] of headings.entries()) {
			expect(heading.querySelector("svg")).toBeNull();
			const action = heading
				.closest('[data-slot="section-heading"]')
				?.querySelector("button");
			expect(action?.textContent?.trim()).toBe("View all");
			await act(async () => action?.click());
			expect(onTypeFilterChange).toHaveBeenLastCalledWith(
				["connector", "plugin", "skill"][index],
			);
		}
		await render({ typeFilter: "skill" });
		expect(
			container.querySelectorAll('button[aria-label^="Install "]'),
		).toHaveLength(8);
		expect(container.textContent).not.toContain("View all");
		expect(sectionHeading("Skills")?.textContent).toBe("Skills");
		expect(
			sectionHeading("Skills")?.parentElement?.querySelector(
				'[data-slot="section-heading-count"]',
			)?.textContent,
		).toBe("8");
		await render({ searchQuery: "First", searchResults: true });
		expect(container.querySelector("h3")).toBeNull();
		expect(
			container.querySelectorAll('button[aria-label^="Install "]'),
		).toHaveLength(1);
	});

	it("shows interactive suggestions below the connector preview and leaves search results focused on matching items", async () => {
		await render();
		const suggested = sectionHeading("Suggested");
		const connectors = sectionHeading("Connectors");
		expect(suggested).toBeDefined();
		expect(connectors).toBeDefined();
		expect(
			suggested &&
				connectors &&
				suggested.compareDocumentPosition(connectors) &
					Node.DOCUMENT_POSITION_PRECEDING,
		).toBeTruthy();
		expect(container.textContent).toContain("Organize your day");
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('button[aria-label="Connect Gmail"]')
				?.click(),
		);
		expect(mocks.connect).toHaveBeenCalledWith("gmail");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		await act(async () =>
			connectors
				?.closest('[data-slot="section-heading"]')
				?.querySelector("button")
				?.click(),
		);
		expect(connectorFilter()?.getAttribute("aria-checked")).toBe("true");

		await render({ searchQuery: "gmail", searchResults: true });
		expect(sectionHeading("Suggested")).toBeUndefined();
		expect(container.textContent).not.toContain("Organize your day");
		expect(
			container.querySelector('button[aria-label="View Gmail details"]'),
		).not.toBeNull();
		await render({ searchQuery: "", searchResults: true });
		expect(sectionHeading("Suggested")).toBeUndefined();
		expect(container.textContent).not.toContain("Organize your day");
		await render({ typeFilter: "skill" });
		expect(sectionHeading("Suggested")).toBeUndefined();
	});

	it("keeps connectors usable when the separate marketplace catalog fails", async () => {
		mocks.marketplace.mockRejectedValue(new Error("Marketplace unavailable"));
		await render();
		await act(async () => connectorFilter()?.click());
		expect(container.textContent).toContain("Gmail");
		expect(container.textContent).not.toContain("Marketplace unavailable");
	});
	it("caps the connector preview while keeping category labels count-free and searching the full catalog", async () => {
		mocks.catalog.mockResolvedValue({
			toolkits: Array.from({ length: 121 }, (_, i) => ({
				slug: `app_${i}`,
				name: `App ${i}`,
			})),
		});
		await render();
		expect(connectorFilter()?.textContent).toBe("ConnectorsBeta");
		const section = container.querySelector('section[aria-label="Connectors"]');
		expect(sectionHeading("Connectors")?.textContent).toBe("Connectors");
		expect(
			sectionHeading("Connectors")?.parentElement?.querySelector(
				'[data-slot="section-heading-count"]',
			)?.textContent,
		).toBeUndefined();
		expect(sectionHeading("Connectors")?.querySelector("svg")).toBeNull();
		expect(
			section?.querySelectorAll('button[aria-label^="View "]'),
		).toHaveLength(6);
		expect(intersections.size).toBe(0);
		expect(section?.textContent).not.toContain("search to find");
		await render({ searchQuery: "App 120", searchResults: true });
		const results = container.querySelector('section[aria-label="Connectors"]');
		expect(
			results?.querySelectorAll('button[aria-label^="View "]'),
		).toHaveLength(1);
		expect(results?.textContent).toContain("App 120");
	});
	it("appends pages on scroll through the full catalog without requesting it again", async () => {
		mocks.catalog.mockResolvedValue({
			toolkits: Array.from({ length: 73 }, (_, i) => ({
				slug: `app_${i}`,
				name: `App ${i}`,
			})),
		});
		await render();
		await act(async () =>
			sectionHeading("Connectors")
				?.closest('[data-slot="section-heading"]')
				?.querySelector("button")
				?.click(),
		);
		expect(connectorFilter()?.getAttribute("aria-checked")).toBe("true");
		const initialCatalogRequests = mocks.catalog.mock.calls.length;
		const section = container.querySelector('section[aria-label="Connectors"]');
		expect(section?.textContent).not.toContain("search to find");
		for (const count of [48, 72, 73]) {
			await act(async () =>
				[...intersections].forEach((callback) => {
					callback();
				}),
			);
			expect(
				section?.querySelectorAll('button[aria-label^="View "]'),
			).toHaveLength(count);
			expect(connectorFilter()?.textContent).toBe("ConnectorsBeta");
		}
		expect(intersections.size).toBe(0);
		expect(
			new Set(
				[
					...(section?.querySelectorAll('button[aria-label^="View "]') ?? []),
				].map((button) => button.getAttribute("aria-label")),
			).size,
		).toBe(73);
		expect(mocks.catalog).toHaveBeenCalledTimes(initialCatalogRequests);
	});
});

describe("Integrated marketplace search", () => {
	it("uses the host query across categories and connectors, excludes installed entries, and reports the complete count", async () => {
		mocks.marketplace.mockResolvedValue({
			tags: [],
			entries: [
				{ ...exampleSkill, name: "GitHub skill" },
				{ ...exampleSkill, id: "installed", name: "GitHub installed" },
				{
					...exampleSkill,
					id: "plugin",
					type: "plugin",
					name: "GitHub plugin",
				},
			],
		});
		mocks.invoke.mockResolvedValue({ installedKeys: ["skill:installed"] });
		mocks.integrations = [{ toolkit: "gmail", status: "connected" }];
		const onSummary = vi.fn();
		await render({
			searchQuery: " GitHub ",
			searchResults: true,
			typeFilter: "mcp",
			onSummary,
		});
		expect(container.querySelector("input")).toBeNull();
		expect(container.querySelector('[role="radiogroup"]')).toBeNull();
		expect(container.querySelector('[data-slot="scroll-area"]')).toBeNull();
		expect(container.textContent).toContain("GitHub skill");
		expect(container.textContent).toContain("GitHub plugin");
		expect(container.textContent).not.toContain("GitHub installed");
		expect(container.textContent).not.toContain("Gmail");
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "github",
			count: 3,
			loading: false,
			error: false,
		});
		await render({ searchQuery: "", searchResults: true, onSummary });
		expect(container.querySelector("input")).toBeNull();
		expect(container.textContent).not.toContain("Gmail");
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "",
			count: 3,
			loading: false,
			error: false,
		});
	});

	it.each([
		{ entry: exampleSkill, searchResults: false },
		{ entry: exampleMcp, searchResults: false },
		{ entry: examplePlugin, searchResults: false },
		{ entry: exampleSkill, searchResults: true },
		{ entry: exampleMcp, searchResults: true },
		{ entry: examplePlugin, searchResults: true },
	])("delegates $entry.type details to the page host with searchResults=$searchResults", async ({
		entry,
		searchResults,
	}) => {
		mocks.configured = false;
		mocks.marketplace.mockResolvedValue({ tags: [], entries: [entry] });
		const onOpenDetail = vi.fn();
		const onSummary = vi.fn();
		await render({
			searchQuery: "example",
			searchResults,
			onOpenDetail,
			onSummary,
		});
		const trigger = container.querySelector<HTMLButtonElement>(
			`button[aria-label="View ${entry.name} details"]`,
		);
		expect(trigger).not.toBeNull();
		await act(async () => trigger?.click());
		expect(onOpenDetail).toHaveBeenCalledExactlyOnceWith(entry, trigger);
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			1,
		);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		if (searchResults) {
			expect(onSummary).toHaveBeenLastCalledWith({
				query: "example",
				count: 1,
				loading: false,
				error: false,
			});
		}
	});

	it("renders skill content and delegates detail tag selection to its host", async () => {
		const entry = { ...exampleSkill, tags: ["development"] };
		mocks.marketplace.mockResolvedValue({
			tags: [{ id: "development", label: "Development", count: 1 }],
			entries: [entry],
		});
		mocks.invoke.mockResolvedValue({ installedKeys: ["skill:example-skill"] });
		const onSelectTag = vi.fn();
		const onBack = vi.fn();
		await act(async () =>
			root.render(
				<MarketplaceEntryDetailPage
					entry={entry}
					onBack={onBack}
					onSelectTag={onSelectTag}
				/>,
			),
		);
		expect(
			container.querySelector('[aria-label="Skill content"]')?.textContent,
		).toBe("Example skill files");
		expect(
			[...container.querySelectorAll("button")].some(
				(button) => button.textContent === "Uninstall",
			),
		).toBe(true);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'button[title="Filter by Development"]',
				)
				?.click(),
		);
		expect(onSelectTag).toHaveBeenCalledExactlyOnceWith("development");
		expect(onBack).not.toHaveBeenCalled();
	});

	it.each([
		{ entry: exampleMcp, label: "MCP" },
		{ entry: examplePlugin, label: "Plugin" },
	])("shows $label metadata and setup on a standalone page with working installed actions", async ({
		entry,
		label,
	}) => {
		mocks.marketplace.mockResolvedValue({ tags: [], entries: [entry] });
		mocks.invoke.mockImplementation(async (command: string) => {
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [`${entry.type}:${entry.id}`] };
			if (command === "uninstall_marketplace_entry")
				return { status: "uninstalled", message: `${label} removed.` };
			throw new Error(`Unexpected command: ${command}`);
		});
		const onBack = vi.fn();
		await act(async () =>
			root.render(
				<MarketplaceEntryDetailPage
					entry={entry}
					backLabel="Search results"
					onBack={onBack}
				/>,
			),
		);
		expect(
			container.querySelector(`nav[aria-label="${label} navigation"]`),
		).not.toBeNull();
		expect(
			container.querySelector('[aria-label="Browse categories"]'),
		).toBeNull();
		expect(container.querySelector('[aria-label="Skill content"]')).toBeNull();
		expect(container.textContent).toContain("EXAMPLE_API_KEY");
		expect(container.textContent).toContain(entry.install.notes);
		const uninstall = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Uninstall",
		);
		expect(uninstall).toBeDefined();
		await act(async () => uninstall?.click());
		const confirmation = document.querySelector('[role="alertdialog"]');
		expect(confirmation?.textContent).toContain(
			`Uninstall ${label === "MCP" ? "MCP server" : label.toLowerCase()}?`,
		);
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"uninstall_marketplace_entry",
			expect.anything(),
			expect.anything(),
		);
		await confirmUninstall();
		expect(mocks.invoke).toHaveBeenCalledWith(
			"uninstall_marketplace_entry",
			{ entry },
			{ timeoutMs: entry.type === "mcp" ? null : 300_000 },
		);
		expect(container.textContent).toContain(`${label} removed.`);
		expect(
			[...container.querySelectorAll("button")].some(
				(button) => button.textContent === "Install",
			),
		).toBe(true);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Back to Search results"]',
				)
				?.click(),
		);
		expect(onBack).toHaveBeenCalledOnce();
	});

	it("reports unknown installed status as loading and preserves inventory errors", async () => {
		mocks.configured = false;
		mocks.marketplace.mockResolvedValue({ tags: [], entries: [exampleSkill] });
		let rejectStatus: (error: Error) => void = () => {};
		mocks.invoke.mockImplementation(
			() =>
				new Promise((_, reject) => {
					rejectStatus = reject;
				}),
		);
		const onSummary = vi.fn();
		await render({
			searchResults: true,
			searchQuery: "example",
			onSummary,
		});
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "example",
			count: 0,
			loading: true,
			error: false,
		});
		expect(addSkillButton()).toBeNull();
		await act(async () => rejectStatus(new Error("Inventory unavailable")));
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "example",
			count: 0,
			loading: false,
			error: true,
		});
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Inventory unavailable",
		);
	});

	it("invalidates the installed inventory after Add and ignores a status read that began before the successful install", async () => {
		mocks.configured = false;
		mocks.marketplace.mockResolvedValue({ tags: [], entries: [exampleSkill] });
		let finishRefresh: (response: { installedKeys: string[] }) => void =
			() => {};
		let finishInstall: (response: { message: string }) => void = () => {};
		let statusReads = 0;
		mocks.invoke.mockImplementation((command: string) => {
			if (command === "install_marketplace_entry")
				return new Promise((resolve) => {
					finishInstall = resolve;
				});
			if (++statusReads === 1) return Promise.resolve({ installedKeys: [] });
			return new Promise((resolve) => {
				finishRefresh = resolve;
			});
		});
		await render({ searchResults: true, searchQuery: "example" });
		await act(async () => addSkillButton()?.click());
		await act(async () => invalidateExtensionInventoryCache());
		const onInventoryInvalidated = vi.fn();
		const unsubscribe = subscribeToExtensionInventoryInvalidation(
			onInventoryInvalidated,
		);
		await act(async () => finishInstall({ message: "Added" }));
		unsubscribe();
		expect(onInventoryInvalidated).toHaveBeenCalledOnce();
		expect(addSkillButton()).toBeNull();
		await act(async () => finishRefresh({ installedKeys: [] }));
		expect(addSkillButton()).toBeNull();
	});

	it("refreshes installed keys after settings changes and inventory invalidations", async () => {
		mocks.configured = false;
		mocks.marketplace.mockResolvedValue({ tags: [], entries: [exampleSkill] });
		await render({ searchResults: true, searchQuery: "example" });
		expect(addSkillButton()).not.toBeNull();
		mocks.invoke.mockResolvedValue({ installedKeys: ["skill:example-skill"] });
		await act(async () => {
			for (const listener of mocks.settingsListeners) listener();
		});
		expect(addSkillButton()).toBeNull();
		mocks.invoke.mockResolvedValue({ installedKeys: [] });
		await act(async () => invalidateExtensionInventoryCache());
		expect(addSkillButton()).not.toBeNull();
	});
});
