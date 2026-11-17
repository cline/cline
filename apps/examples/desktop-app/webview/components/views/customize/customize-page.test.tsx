// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetComposioCacheForTesting } from "@/lib/composio";
import { invalidateExtensionInventoryCache } from "@/lib/extension-inventory";
import type { MarketplaceEntry } from "@/lib/marketplace";
import { CustomizePage } from "./customize-page";
import type { CustomizeSection } from "./customize-sections";
import {
	CustomizeTestHarness,
	createCustomizeTestRoot,
	findButton,
	setInputValue,
} from "./customize-test-utils";
import type { InstalledSkillSelection } from "./extensions/installed-skill-detail";
import type { InstalledCustomizationActions } from "./installed-customization-sections";
import type { ManageCustomizationsView } from "./manage-customizations-view";
import type { MarketplaceEntryDetailPage } from "./marketplace/marketplace-entry-detail-page";
import type { MarketplaceExplorerView } from "./marketplace/marketplace-explorer-view";
import {
	type MarketplaceTypeFilter,
	TYPE_META,
} from "./marketplace/marketplace-type-meta";
import { AddMcpServerButton } from "./mcp/add-mcp-server-button";
import type { McpServerEditorPage } from "./mcp/mcp-server-editor-page";
import {
	browseFilterToCustomizeTab,
	type CustomizeTab,
	customizeTabToBrowseFilter,
} from "./navigation/customize-categories";
import { CustomizeCategoryBar } from "./navigation/customize-category-bar";
import type { CustomizeSearchResults } from "./search/customize-search-results";
import { CustomizationCategorySection } from "./shared/customization-category-section";
import { CustomizationDetailPage } from "./shared/customization-detail-page";
import { CustomizationTypeBadge } from "./shared/customization-type-badge";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe: vi.fn(() => () => {}) },
	isTauriAvailable: vi.fn(() => false),
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/marketplace", () => ({
	fetchMarketplaceCatalog: vi.fn(async () => ({
		entries: [],
		tags: [{ id: "development", label: "Development", count: 1 }],
	})),
	getCachedMarketplaceCatalog: () => null,
}));
vi.mock("./marketplace/marketplace-skill-preview", () => ({
	InstalledSkillPreview: ({ skillPath }: { skillPath: string }) => (
		<div data-testid="installed-skill-content">{skillPath}</div>
	),
}));

const installedSkill = {
	name: "Installed skill",
	description: "Local instructions",
	path: "/skills/installed/SKILL.md",
	instructions: "# Installed instructions",
} satisfies InstalledSkillSelection["skill"];

function marketplaceEntry(
	type: MarketplaceEntry["type"],
	name: string,
): MarketplaceEntry {
	return {
		id: name.toLowerCase().replaceAll(" ", "-"),
		type,
		name,
		tagline: `${name} description`,
		description: `${name} description`,
		tags: ["development"],
		install: { command: "", args: [] },
	};
}

/** The shell owns navigation; these small lists only expose its action callbacks. */
function InstalledActions({
	actions,
}: {
	actions: InstalledCustomizationActions;
}) {
	return (
		<>
			<button
				type="button"
				aria-label="View Installed skill details"
				onClick={(event) =>
					actions.onOpenSkill?.(
						{
							skill: installedSkill,
							entry: marketplaceEntry("skill", installedSkill.name),
						},
						event.currentTarget,
					)
				}
			>
				Installed skill
			</button>
			<button
				type="button"
				aria-label="View Installed MCP details"
				onClick={(event) =>
					actions.onOpenMcp?.(
						{
							server: {
								name: "Installed MCP",
								transportType: "stdio",
								command: "test-server",
								disabled: false,
							},
						},
						event.currentTarget,
					)
				}
			>
				Installed MCP
			</button>
			<button type="button" onClick={actions.onOpenModelProviders}>
				Open model providers
			</button>
		</>
	);
}

function MarketplaceCards({
	origin,
	onOpen,
}: {
	origin: "Catalog" | "Browse";
	onOpen?: (entry: MarketplaceEntry, trigger: HTMLButtonElement) => void;
}) {
	return (["skill", "mcp", "plugin"] as const).map((type) => {
		const entry = marketplaceEntry(type, `${origin} ${TYPE_META[type].short}`);
		return (
			<button
				key={type}
				type="button"
				aria-label={`View ${entry.name} details`}
				onClick={(event) => onOpen?.(entry, event.currentTarget)}
			>
				{entry.name}
			</button>
		);
	});
}

vi.mock("./search/customize-search-results", () => ({
	CustomizeSearchResults: ({
		query,
		actions,
		onOpenMarketplaceDetail,
	}: ComponentProps<typeof CustomizeSearchResults>) => (
		<div data-testid="customization-search-results" data-query={query}>
			<InstalledActions actions={actions} />
			<MarketplaceCards origin="Catalog" onOpen={onOpenMarketplaceDetail} />
		</div>
	),
}));
vi.mock("./manage-customizations-view", () => ({
	ManageCustomizationsView: ({
		tab,
		onTabChange,
		actions,
	}: ComponentProps<typeof ManageCustomizationsView>) => (
		<div data-category={tab} data-testid="manage-content">
			<CustomizeCategoryBar
				mode="manage"
				value={tab}
				onValueChange={onTabChange}
			/>
			<InstalledActions actions={actions} />
			<AddMcpServerButton onCreateMcp={actions.onCreateMcp} />
		</div>
	),
}));
vi.mock("./marketplace/marketplace-explorer-view", () => ({
	MarketplaceExplorerView: ({
		typeFilter,
		onTypeFilterChange,
		onOpenDetail,
		onCreateMcp,
	}: ComponentProps<typeof MarketplaceExplorerView>) => (
		<div data-category={typeFilter ?? "all"} data-testid="browse-content">
			<CustomizeCategoryBar
				mode="browse"
				value={browseFilterToCustomizeTab(typeFilter)}
				onValueChange={(category) =>
					onTypeFilterChange(customizeTabToBrowseFilter(category) ?? null)
				}
				connectorsAvailable
			/>
			<AddMcpServerButton onCreateMcp={onCreateMcp} />
			<MarketplaceCards origin="Browse" onOpen={onOpenDetail} />
		</div>
	),
}));
vi.mock("./mcp/mcp-server-editor-page", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./mcp/mcp-server-editor-page")>();
	return {
		McpServerEditorPage: (
			props: ComponentProps<typeof McpServerEditorPage>,
		) => {
			// Creation tests exercise the real form; installed details expose only
			// the shell navigation callbacks tested in this suite.
			if (!props.server) return <actual.McpServerEditorPage {...props} />;
			const { server, backLabel = "Manage", onBack } = props;
			return (
				<CustomizationDetailPage
					backLabel={backLabel}
					onBack={onBack}
					navigationLabel="MCP navigation"
				>
					<CustomizationTypeBadge type="mcp" />
					<h2>{server.name}</h2>
					<CustomizationCategorySection categories={["development"]} />
					<button type="button" onClick={() => onBack({ uninstalled: true })}>
						Delete MCP
					</button>
				</CustomizationDetailPage>
			);
		},
	};
});
vi.mock("./marketplace/marketplace-entry-detail-page", () => ({
	MarketplaceEntryDetailPage: ({
		entry,
		backLabel = "Browse",
		onBack,
		onSelectTag,
	}: ComponentProps<typeof MarketplaceEntryDetailPage>) => (
		<CustomizationDetailPage
			backLabel={backLabel}
			onBack={onBack}
			navigationLabel={`${TYPE_META[entry.type].short} navigation`}
		>
			<CustomizationTypeBadge type={entry.type} />
			<h2>{entry.name}</h2>
			<CustomizationCategorySection
				categories={entry.tags}
				onSelectCategory={onSelectTag}
			/>
		</CustomizationDetailPage>
	),
}));

let container: HTMLDivElement;
let root: Root;
let cleanup: () => Promise<void>;

beforeEach(() => {
	({ container, root, cleanup } = createCustomizeTestRoot());
	invalidateExtensionInventoryCache();
	resetComposioCacheForTesting();
	if (typeof window.localStorage?.clear !== "function") {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: window.sessionStorage,
		});
	}
	window.localStorage.clear();
	invoke.mockReset().mockImplementation(async (command: string) => {
		if (command === "list_user_instruction_configs")
			return { skills: [installedSkill] };
		if (command === "list_mcp_servers")
			return {
				settingsPath: "/settings/mcp.json",
				hasSettingsFile: true,
				servers: [],
			};
		if (command === "composio_integrations")
			return { configured: false, integrations: [] };
		if (command === "uninstall_local_primitive") return {};
		throw new Error(`Unexpected desktop command: ${command}`);
	});
});
afterEach(async () => cleanup());

function NavigationHarness(props: ComponentProps<typeof CustomizeTestHarness>) {
	return <CustomizeTestHarness initialSection="browse" {...props} />;
}

async function clickButton(label: string) {
	const category = /^(Browse|Manage) ([a-z]+)$/.exec(label);
	if (category) {
		const [, page, value] = category;
		const categoryId =
			page === "Browse"
				? browseFilterToCustomizeTab(
						value === "all" ? null : (value as MarketplaceTypeFilter),
					)
				: value;
		const button = container.querySelector<HTMLButtonElement>(
			`[aria-label="${page} categories"] [data-customize-category="${categoryId}"]`,
		);
		if (!button) throw new Error(`Missing category: ${label}`);
		await act(async () => button.click());
		return;
	}
	await act(async () => findButton(container, label).click());
}

async function typeQuery(value: string) {
	const input = container.querySelector<HTMLInputElement>(
		'input[aria-label="Search customizations"]',
	);
	if (!input) throw new Error("Missing Customize search");
	await setInputValue(input, value);
}

async function selectDevelopmentCategory() {
	const button = container.querySelector<HTMLButtonElement>(
		'button[title="Filter by Development"]',
	);
	if (!button) throw new Error("Missing Development detail category");
	await act(async () => button.click());
}

function selectedCategory(view: "manage" | "browse") {
	return container
		.querySelector(`[data-testid="${view}-content"]`)
		?.getAttribute("data-category");
}

describe("CustomizePage navigation", () => {
	it.each([
		["manage", "Manage"],
		["browse", "Browse"],
	] as const)("returns from MCP creation in %s after Back", async (section, label) => {
		await act(async () =>
			root.render(
				<NavigationHarness initialCategory="mcp" initialSection={section} />,
			),
		);
		const origin = container.querySelector(
			`[data-testid="${label.toLowerCase()}-content"]`,
		);
		const trigger = Array.from(origin?.querySelectorAll("button") ?? []).find(
			(button) => button.textContent?.trim() === "Add MCP server",
		);
		const viewport = trigger?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!trigger || !viewport) throw new Error("Missing MCP creation action");
		await act(async () => {
			viewport.scrollTop = 360;
			trigger.focus();
			trigger.click();
		});
		expect(origin?.closest("[hidden]")).not.toBeNull();
		expect(
			container.querySelector('form[aria-label="New MCP server"]'),
		).not.toBeNull();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(container.querySelector("#mcp-name"));
		viewport.scrollTop = 0;
		await clickButton(`Back to ${label}`);
		expect(
			container.querySelector('form[aria-label="New MCP server"]'),
		).toBeNull();
		expect(origin?.closest("[hidden]")).toBeNull();
		expect(selectedCategory(label.toLowerCase() as "manage" | "browse")).toBe(
			"mcp",
		);
		expect(viewport.scrollTop).toBe(360);
		expect(document.activeElement).toBe(trigger);
	});

	it.each([
		"Manage",
		"Search",
	] as const)("opens model providers from %s using the explicit settings callback", async (view) => {
		const onOpenModelProviders = vi.fn();
		const onNavigateSection = vi.fn();
		await act(async () => {
			root.render(
				<CustomizePage
					section="manage"
					customizeCategory="all"
					onCustomizeCategoryChange={vi.fn()}
					onNavigateSection={onNavigateSection}
					onOpenModelProviders={onOpenModelProviders}
				/>,
			);
		});
		if (view === "Search") await typeQuery("model");
		await clickButton("Open model providers");
		expect(onOpenModelProviders).toHaveBeenCalledOnce();
		expect(onNavigateSection).not.toHaveBeenCalled();
	});

	it.each([
		"all",
		"mcp",
	] as const)("opens installed MCP details from Manage %s and restores the list position", async (category) => {
		await act(async () =>
			root.render(
				<NavigationHarness
					initialCategory={category}
					initialSection="manage"
				/>,
			),
		);
		const trigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="View Installed MCP details"]',
		);
		const viewport = trigger?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!trigger || !viewport) throw new Error("Missing MCP card");
		await act(async () => {
			viewport.scrollTop = 360;
			trigger.focus();
			trigger.click();
		});
		expect(
			container
				.querySelector('[data-testid="manage-content"]')
				?.closest("[hidden]"),
		).not.toBeNull();
		const back = container.querySelector<HTMLButtonElement>(
			'[aria-label="Back to Manage"]',
		);
		expect(document.activeElement).toBe(back);
		expect(
			container.querySelector('[aria-label="MCP navigation"]'),
		).not.toBeNull();
		viewport.scrollTop = 0;
		await act(async () => back?.click());
		expect(selectedCategory("manage")).toBe(category);
		expect(viewport.scrollTop).toBe(360);
		expect(document.activeElement).toBe(trigger);
	});

	it.each([
		["Installed skill", "skills", "Skill"],
		["Installed MCP", "mcp", "MCP"],
		["Catalog MCP", "mcp", "MCP"],
		["Catalog Plugin", "plugins", "Plugin"],
	] as const)("returns %s details to the same search results", async (name, category, label) => {
		await act(async () =>
			root.render(<NavigationHarness initialCategory={category} />),
		);
		const input = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search customizations"]',
		);
		await typeQuery(label);
		const results = container.querySelector(
			'[data-testid="customization-search-results"]',
		);
		const trigger = [
			...container.querySelectorAll<HTMLButtonElement>("button"),
		].find((button) => button.textContent === name);
		await act(async () => trigger?.click());
		expect(results?.closest("[hidden]")).not.toBeNull();
		const back = container.querySelector<HTMLButtonElement>(
			'[aria-label="Back to Search results"]',
		);
		expect(document.activeElement).toBe(back);
		expect(
			container.querySelector(`[aria-label="${label} navigation"]`),
		).not.toBeNull();
		await act(async () => back?.click());
		expect(
			container.querySelector('[data-testid="customization-search-results"]'),
		).toBe(results);
		expect(results?.closest("[hidden]")).toBeNull();
		expect(input?.value).toBe(label);
		expect(results?.getAttribute("data-query")).toBe(label);
		expect(document.activeElement).toBe(trigger);
	});

	it("restores focus to search after deleting an installed MCP", async () => {
		await act(async () =>
			root.render(<NavigationHarness initialSection="manage" />),
		);
		const input = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search customizations"]',
		);
		await typeQuery("MCP");
		await clickButton("Installed MCP");
		await clickButton("Delete MCP");
		expect(container.querySelector('[aria-label="MCP navigation"]')).toBeNull();
		expect(document.activeElement).toBe(input);
		expect(input?.value).toBe("MCP");
	});

	it.each([
		"all",
		"skills",
	] as const)("opens installed details from Manage %s and restores the category, scroll, and focus", async (category) => {
		await act(async () =>
			root.render(
				<NavigationHarness
					initialCategory={category}
					initialSection="manage"
				/>,
			),
		);
		const trigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="View Installed skill details"]',
		);
		const viewport = trigger?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!trigger || !viewport) throw new Error("Missing installed skill card");
		// Global and project installations can share the same visible name.
		const otherInstallation = trigger.cloneNode(true);
		trigger.before(otherInstallation);
		await act(async () => {
			viewport.scrollTop = 420;
			trigger.focus();
			trigger.click();
		});
		expect(
			container
				.querySelector('[data-testid="manage-content"]')
				?.closest("[hidden]"),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="installed-skill-content"]')
				?.textContent,
		).toBe("/skills/installed/SKILL.md");
		const back = container.querySelector<HTMLButtonElement>(
			'[aria-label="Back to Manage"]',
		);
		expect(document.activeElement).toBe(back);
		// Hidden viewports can lose their scroll offset when the browser relayouts.
		viewport.scrollTop = 0;
		await act(async () => back?.click());
		expect(
			container.querySelector('[aria-label="Skill navigation"]'),
		).toBeNull();
		expect(selectedCategory("manage")).toBe(category);
		expect(
			container
				.querySelector('[data-testid="manage-content"]')
				?.closest("[hidden]"),
		).toBeNull();
		expect(viewport.scrollTop).toBe(420);
		expect(document.activeElement).toBe(trigger);
		otherInstallation.parentNode?.removeChild(otherInstallation);
	});

	it("restores focus to a stable control after uninstalling from search results", async () => {
		await act(async () =>
			root.render(<NavigationHarness initialSection="manage" />),
		);
		const input = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search customizations"]',
		);
		await typeQuery("Installed");
		await clickButton("Installed skill");
		await clickButton("Uninstall");
		const confirmation = document.querySelector('[role="alertdialog"]');
		expect(confirmation).not.toBeNull();
		const confirmUninstall = [
			...(confirmation?.querySelectorAll("button") ?? []),
		].find((button) => button.textContent === "Uninstall");
		expect(confirmUninstall).toBeDefined();
		await act(async () => confirmUninstall?.click());
		expect(
			container.querySelector('[aria-label="Skill navigation"]'),
		).toBeNull();
		expect(document.activeElement).toBe(input);
		expect(input?.value).toBe("Installed");
	});

	it.each([
		["MCP", "mcp", "mcp"],
		["Plugin", "plugins", "plugin"],
	] as const)("returns Browse %s details to the existing page, category, scroll position, and focused card", async (label, category, typeFilter) => {
		await act(async () =>
			root.render(<NavigationHarness initialCategory={category} />),
		);
		const content = container.querySelector('[data-testid="browse-content"]');
		const trigger = container.querySelector<HTMLButtonElement>(
			`[aria-label="View Browse ${label} details"]`,
		);
		const search = container.querySelector(
			'input[aria-label="Search customizations"]',
		);
		const viewport = trigger?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!viewport || !trigger) throw new Error("Missing Browse content");
		viewport.scrollTop = 240;
		await act(async () => trigger.click());
		expect(content?.closest("[hidden]")).not.toBeNull();
		const back = container.querySelector<HTMLButtonElement>(
			'[aria-label="Back to Browse"]',
		);
		expect(document.activeElement).toBe(back);
		expect(
			container.querySelector(`[aria-label="${label} navigation"]`),
		).not.toBeNull();
		viewport.scrollTop = 0;
		await act(async () => back?.click());
		expect(container.querySelector('[data-testid="browse-content"]')).toBe(
			content,
		);
		expect(content?.closest("[hidden]")).toBeNull();
		expect(selectedCategory("browse")).toBe(typeFilter);
		expect(
			container.querySelector('input[aria-label="Search customizations"]'),
		).toBe(search);
		expect(viewport.scrollTop).toBe(240);
		expect(document.activeElement).toBe(trigger);
	});

	it.each([
		["MCP", "mcp"],
		["Plugin", "plugins"],
	] as const)("returns a Browse %s detail tag to the shared filter at the top of the list", async (label, category) => {
		await act(async () =>
			root.render(<NavigationHarness initialCategory={category} />),
		);
		const trigger = container.querySelector<HTMLButtonElement>(
			`[aria-label="View Browse ${label} details"]`,
		);
		const viewport = trigger?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!viewport || !trigger) throw new Error("Missing Browse content");
		viewport.scrollTop = 240;
		await act(async () => trigger.click());
		await selectDevelopmentCategory();
		expect(
			container.querySelector(`[aria-label="${label} navigation"]`),
		).toBeNull();
		expect(
			container.querySelector('[aria-label^="Filter by category"]')
				?.textContent,
		).toBe("Development");
		expect(viewport.scrollTop).toBe(0);
		expect(selectedCategory("browse")).toBe(
			category === "plugins" ? "plugin" : category,
		);
		expect(document.activeElement).toBe(
			container.querySelector('[aria-label^="Filter by category"]'),
		);
		await clickButton("Manage");
		expect(
			container.querySelector('[data-testid="browse-content"]'),
		).toBeNull();
		expect(
			container.querySelector('[aria-label^="Filter by category"]')
				?.textContent,
		).toBe("Development");
	});

	it.each([
		["Installed skill", "all", "Skill"],
		["Installed skill", "skills", "Skill"],
		["Installed MCP", "all", "MCP"],
		["Installed MCP", "mcp", "MCP"],
	] as const)("filters Manage from %s details while preserving the %s tab", async (name, category, label) => {
		await act(async () =>
			root.render(
				<NavigationHarness
					initialCategory={category}
					initialSection="manage"
				/>,
			),
		);
		const trigger = container.querySelector<HTMLButtonElement>(
			`[aria-label="View ${name} details"]`,
		);
		const viewport = trigger?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!trigger || !viewport) throw new Error("Missing Manage content");
		viewport.scrollTop = 320;
		await act(async () => trigger.click());
		await selectDevelopmentCategory();
		expect(
			container.querySelector(`[aria-label="${label} navigation"]`),
		).toBeNull();
		expect(selectedCategory("manage")).toBe(category);
		expect(
			container
				.querySelector('[data-testid="manage-content"]')
				?.closest("[hidden]"),
		).toBeNull();
		const categoryFilter = container.querySelector(
			'[aria-label^="Filter by category"]',
		);
		expect(categoryFilter?.textContent).toBe("Development");
		expect(viewport.scrollTop).toBe(0);
		expect(document.activeElement).toBe(categoryFilter);
	});

	it.each([
		["Installed skill", "skills", "Skill", "manage", "manage", "skills"],
		["Installed MCP", "mcp", "MCP", "manage", "manage", "mcp"],
		["Catalog Plugin", "plugins", "Plugin", "manage", "manage", "plugins"],
		["Catalog MCP", "mcp", "MCP", "browse", "browse", "mcp"],
		["Catalog Plugin", "plugins", "Plugin", "browse", "browse", "plugin"],
	] as const)("clears search when selecting a category from %s details on %s", async (name, category, label, section, view, typeFilter) => {
		await act(async () =>
			root.render(
				<NavigationHarness
					initialCategory={category}
					initialSection={section}
				/>,
			),
		);
		const input = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search customizations"]',
		);
		await typeQuery(name);
		await clickButton(name);
		expect(
			container.querySelector('[aria-label="Back to Search results"]'),
		).not.toBeNull();
		await selectDevelopmentCategory();
		expect(input?.value).toBe("");
		expect(
			container.querySelector('[data-testid="customization-search-results"]'),
		).toBeNull();
		expect(
			container.querySelector(`[aria-label="${label} navigation"]`),
		).toBeNull();
		expect(selectedCategory(view)).toBe(typeFilter);
		const categoryFilter = container.querySelector(
			'[aria-label^="Filter by category"]',
		);
		expect(categoryFilter?.textContent).toBe("Development");
		expect(document.activeElement).toBe(categoryFilter);
		expect(
			container
				.querySelector(`[data-testid="${view}-content"]`)
				?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')?.scrollTop,
		).toBe(0);
	});

	it.each([
		["Browse Skill", "browse", false, "Skill", "skills", "skill"],
		["Browse MCP", "browse", false, "MCP", "mcp", "mcp"],
		["Browse Plugin", "browse", false, "Plugin", "plugins", "plugin"],
		["Installed skill", "manage", false, "Skill", "skills", "skill"],
		["Installed MCP", "manage", false, "MCP", "mcp", "mcp"],
		["Installed skill", "manage", true, "Skill", "skills", "skill"],
		["Installed MCP", "manage", true, "MCP", "mcp", "mcp"],
		["Catalog Plugin", "manage", true, "Plugin", "plugins", "plugin"],
		["Catalog Skill", "browse", true, "Skill", "skills", "skill"],
		["Catalog MCP", "browse", true, "MCP", "mcp", "mcp"],
		["Catalog Plugin", "browse", true, "Plugin", "plugins", "plugin"],
	] as const)("opens the matching Browse type from %s details in %s (search: %s)", async (name, section, searching, label, category, typeFilter) => {
		await act(async () =>
			root.render(<NavigationHarness initialSection={section} />),
		);
		await clickButton(section === "manage" ? "Installed MCP" : "Browse MCP");
		await selectDevelopmentCategory();
		expect(
			container.querySelector('[aria-label^="Filter by category"]')
				?.textContent,
		).toBe("Development");
		const input = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search customizations"]',
		);
		if (searching) {
			await typeQuery(name);
		}
		const viewport = container
			.querySelector(
				'[data-testid$="-content"], [data-testid="customization-search-results"]',
			)
			?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
		if (!viewport) throw new Error("Missing customization results viewport");
		viewport.scrollTop = 320;
		await clickButton(name);
		expect(
			container.querySelector(`[aria-label="${label} navigation"]`),
		).not.toBeNull();
		if (searching) {
			expect(
				container.querySelector('[aria-label="Back to Search results"]'),
			).not.toBeNull();
		}
		const browseType = container.querySelector<HTMLButtonElement>(
			`button[title="Browse ${TYPE_META[typeFilter].plural}"]`,
		);
		expect(browseType).not.toBeNull();
		await act(async () => browseType?.click());

		expect(
			container.querySelector(`[aria-label="${label} navigation"]`),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="customization-search-results"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="manage-content"]'),
		).toBeNull();
		expect(input?.value).toBe("");
		expect(
			container.querySelector('[aria-label^="Filter by category"]')
				?.textContent,
		).toBe("All categories");
		expect(
			container.querySelector('[data-testid="shared-category"]')?.textContent,
		).toBe(category);
		expect(selectedCategory("browse")).toBe(typeFilter);
		const browse = container.querySelector('[data-testid="browse-content"]');
		expect(browse?.closest("[hidden]")).toBeNull();
		expect(
			browse?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
				?.scrollTop,
		).toBe(0);
		const selectedType = browse?.querySelector(
			'[role="radio"][aria-checked="true"]',
		);
		expect(selectedType?.getAttribute("data-customize-category")).toBe(
			category,
		);
		expect(document.activeElement).toBe(selectedType);
	});

	it("preserves the sliding background and focused navigation controls between Browse and Manage", async () => {
		await act(async () => root.render(<NavigationHarness />));
		const categoryHeading = container
			.querySelector("#customize-section-heading")
			?.closest('[data-slot="section-heading"]');
		expect(categoryHeading).not.toBeNull();
		const navigation = container.querySelector<HTMLElement>(
			'nav[aria-label="Customize sections"]',
		);
		const background = navigation?.querySelector('span[aria-hidden="true"]');
		const search = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search customizations"]',
		);
		const buttons = [...(navigation?.querySelectorAll("button") ?? [])];
		const browse = buttons.find(
			(button) => button.textContent?.trim() === "Browse",
		);
		const manage = buttons.find(
			(button) => button.textContent?.trim() === "Manage",
		);
		if (!navigation || !background || !search || !browse || !manage) {
			throw new Error("Missing Customize navigation controls");
		}

		for (const button of [manage, browse]) {
			await act(async () => {
				button.focus();
				button.click();
			});
			const currentNavigation = container.querySelector(
				'nav[aria-label="Customize sections"]',
			);
			expect(currentNavigation).toBe(navigation);
			expect(
				container
					.querySelector("#customize-section-heading")
					?.closest('[data-slot="section-heading"]'),
			).toBe(categoryHeading);
			expect(currentNavigation?.querySelector('span[aria-hidden="true"]')).toBe(
				background,
			);
			expect(
				container.querySelector('input[aria-label="Search customizations"]'),
			).toBe(search);
			expect(button.getAttribute("aria-current")).toBe("page");
			expect(document.activeElement).toBe(button);
			expect(
				container.querySelectorAll('button[aria-label^="Filter by category"]'),
			).toHaveLength(1);
			expect(
				container.querySelector('button[aria-label^="Filter by category"]')
					?.textContent,
			).toBe("All categories");
		}
	});

	it.each([
		"browse",
		"manage",
	] as const)("compacts the shared header when the %s page scrolls", async (initialSection) => {
		await act(async () =>
			root.render(<NavigationHarness initialSection={initialSection} />),
		);
		const heading = container.querySelector("header h1");
		const viewport = heading?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!viewport) throw new Error("Missing shared page viewport");
		expect(heading?.classList.contains("text-2xl")).toBe(true);

		await act(async () => {
			viewport.scrollTop = 100;
			viewport.dispatchEvent(new Event("scroll"));
		});
		expect(heading?.classList.contains("text-lg")).toBe(true);

		await act(async () => {
			viewport.scrollTop = 0;
			viewport.dispatchEvent(new Event("scroll"));
		});
		expect(heading?.classList.contains("text-2xl")).toBe(true);
	});

	it("uses one header search across Browse and Manage and returns to the selected category when cleared", async () => {
		await act(async () =>
			root.render(<NavigationHarness initialCategory="skills" />),
		);
		const input = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search customizations"]',
		);
		expect(input).not.toBeNull();
		input?.focus();
		await typeQuery("calendar");
		expect(document.activeElement).toBe(input);
		expect(
			container.querySelector("#customize-section-heading")?.textContent,
		).toBe("Search results");
		expect(
			container
				.querySelector('[data-testid="customization-search-results"]')
				?.getAttribute("data-query"),
		).toBe("calendar");
		expect(
			container.querySelector('[data-testid="browse-content"]'),
		).toBeNull();
		expect(container.querySelectorAll('input[type="search"]')).toHaveLength(1);
		await act(async () =>
			input?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			),
		);
		expect(input?.value).toBe("");
		expect(selectedCategory("browse")).toBe("skill");

		await clickButton("Manage");
		expect(
			container.querySelector('[aria-label="Refresh customizations"]'),
		).not.toBeNull();
		await clickButton("Manage all");
		const refresh = container.querySelector(
			'[aria-label="Refresh customizations"]',
		);
		expect(refresh?.closest("[data-customize-toolbar-actions]")).not.toBeNull();
		expect(
			refresh
				?.closest("[data-customize-toolbar]")
				?.querySelector('[aria-label="Manage categories"]'),
		).not.toBeNull();
		expect(container.querySelectorAll('[aria-label^="Refresh "]')).toHaveLength(
			1,
		);
		await typeQuery("project rule");
		expect(
			container.querySelector('[aria-label="Refresh customizations"]'),
		).toBeNull();
		expect(
			container
				.querySelector('[data-testid="customization-search-results"]')
				?.getAttribute("data-query"),
		).toBe("project rule");
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'[aria-label="Clear customization search"]',
				)
				?.click(),
		);
		expect(selectedCategory("manage")).toBe("all");
		expect(
			container.querySelector('[aria-label="Refresh customizations"]'),
		).not.toBeNull();
		await clickButton("Manage skills");
		expect(
			container.querySelector('[aria-label="Refresh customizations"]'),
		).not.toBeNull();
		expect(input?.value).toBe("");
		await typeQuery("another query");
		await clickButton("Browse");
		expect(selectedCategory("browse")).toBe("skill");
		expect(
			container.querySelector('[aria-label="Refresh customizations"]'),
		).toBeNull();
		expect(input?.value).toBe("");
	});

	it.each([
		["connectors", "connector"],
		["plugins", "plugin"],
		["skills", "skill"],
		["mcp", "mcp"],
	] as const)("carries %s between Browse and Manage in both directions", async (category, filter) => {
		await act(async () => root.render(<NavigationHarness />));
		expect(selectedCategory("browse")).toBe("all");
		await clickButton(`Browse ${filter}`);
		await clickButton("Manage");
		expect(selectedCategory("manage")).toBe(category);
		await clickButton("Manage all");
		await clickButton(`Manage ${category}`);
		await clickButton("Browse");
		expect(selectedCategory("browse")).toBe(filter);
		expect(
			container.querySelector('[data-testid="shared-category"]')?.textContent,
		).toBe(category);
	});

	it("carries clearing to All from either view", async () => {
		await act(async () =>
			root.render(
				<NavigationHarness initialCategory="skills" initialSection="manage" />,
			),
		);
		await clickButton("Manage all");
		await clickButton("Browse");
		expect(selectedCategory("browse")).toBe("all");
		await clickButton("Browse skill");
		await clickButton("Browse all");
		await clickButton("Manage");
		expect(selectedCategory("manage")).toBe("all");
	});

	it.each([
		"tools",
		"rules",
		"hooks",
	] as const)("falls back from %s to All when entering Browse", async (category) => {
		await act(async () =>
			root.render(
				<NavigationHarness
					initialCategory={category}
					initialSection="manage"
				/>,
			),
		);
		expect(selectedCategory("manage")).toBe(category);
		await clickButton("Browse");
		expect(selectedCategory("browse")).toBe("all");
		expect(
			container.querySelector('[data-testid="shared-category"]')?.textContent,
		).toBe("all");
		await clickButton("Manage");
		expect(selectedCategory("manage")).toBe("all");
	});

	it.each([
		"manage",
		"browse",
	] as const)("applies external category changes without remounting %s", async (section) => {
		const render = async (customizeCategory: CustomizeTab) => {
			await act(async () => {
				root.render(
					<CustomizePage
						customizeCategory={customizeCategory}
						onCustomizeCategoryChange={vi.fn()}
						onNavigateSection={vi.fn()}
						onOpenModelProviders={vi.fn()}
						section={section}
					/>,
				);
			});
		};
		const view = section;
		await render("all");
		const originalContent = container.querySelector(
			`[data-testid="${view}-content"]`,
		);
		expect(selectedCategory(view)).toBe("all");
		await render("connectors");
		expect(selectedCategory(view)).toBe(
			section === "manage" ? "connectors" : "connector",
		);
		expect(container.querySelector(`[data-testid="${view}-content"]`)).toBe(
			originalContent,
		);
		await render("all");
		expect(selectedCategory(view)).toBe("all");
	});

	it("normalizes unsupported selection when history changes the active section", async () => {
		const onCustomizeCategoryChange = vi.fn();
		const render = async (section: CustomizeSection) => {
			await act(async () =>
				root.render(
					<CustomizePage
						customizeCategory="hooks"
						onCustomizeCategoryChange={onCustomizeCategoryChange}
						onNavigateSection={vi.fn()}
						onOpenModelProviders={vi.fn()}
						section={section}
					/>,
				),
			);
		};
		await render("manage");
		expect(onCustomizeCategoryChange).not.toHaveBeenCalled();
		await render("browse");
		expect(selectedCategory("browse")).toBe("all");
		expect(onCustomizeCategoryChange).toHaveBeenCalledExactlyOnceWith("all");
	});
});
