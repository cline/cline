// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposioStatusResponse } from "@/lib/composio-types";
import type { MarketplaceCatalog } from "@/lib/marketplace";

const mocks = vi.hoisted(() => ({
	catalog: vi.fn(),
	connectors: vi.fn(),
	status: vi.fn(),
	invoke: vi.fn(),
	refreshConnections: vi.fn(),
	connectionStatus: null as ComposioStatusResponse | null,
}));

vi.mock("@/lib/marketplace", () => ({
	fetchMarketplaceCatalog: mocks.catalog,
	getCachedMarketplaceCatalog: () => null,
}));
vi.mock("@/lib/use-composio-status", () => ({
	useComposioStatus: () => ({
		status: mocks.connectionStatus,
		loading: false,
		error: null,
		refresh: mocks.refreshConnections,
	}),
}));

vi.mock("@/lib/use-composio-connections", () => ({
	useComposioConnections: () => ({
		configured: true,
		status: mocks.connectionStatus,
		statusBySlug: new Map(
			mocks.connectionStatus?.integrations.map((entry) => [
				entry.toolkit,
				entry,
			]),
		),
		refresh: mocks.refreshConnections,
	}),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: (
			command: string,
			args: { operation?: string },
			options?: unknown,
		) =>
			command === "composio_integrations" && args.operation === "listToolkits"
				? mocks.connectors()
				: mocks.invoke(command, args, options),
		subscribe: () => () => {},
	},
	openExternalUrl: vi.fn(),
}));
vi.mock("../marketplace/marketplace-skill-preview", () => ({
	MarketplaceSkillPreview: ({ entry }: { entry: { name: string } }) => (
		<section aria-label="Skill content">{entry.name} files</section>
	),
}));

import { resetComposioCacheForTesting } from "@/lib/composio";
import { invalidateExtensionInventoryCache } from "@/lib/extension-inventory";
import { clearMarketplaceInstalledEntries } from "@/lib/marketplace-installed";
import { CustomizePage } from "../customize-page";
import type { CustomizeTab } from "./customize-categories";

const catalog: MarketplaceCatalog = {
	version: 1,
	counts: { total: 3, plugins: 2, skills: 1, mcps: 0 },
	tags: [
		{ id: "productivity", label: "Productivity", count: 1 },
		{ id: "developer-tools", label: "Developer tools", count: 2 },
	],
	entries: [
		{
			id: "daily-planner",
			type: "plugin",
			name: "Daily planner",
			tagline: "Plan your work",
			description: "A planning plugin",
			tags: ["productivity"],
			install: { command: "", args: ["example/daily-planner"] },
		},
		{
			id: "code-review",
			type: "plugin",
			name: "Code review",
			tagline: "Review changes",
			description: "A code review plugin",
			tags: ["developer-tools"],
			install: { command: "", args: ["example/code-review"] },
		},
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

/** Exercise the real shared page while navigation remains controlled by its host. */
function CustomizeHarness({
	initialPage = "manage",
}: {
	initialPage?: "browse" | "manage";
}) {
	const [section, setSection] = useState(initialPage);
	const [tab, setTab] = useState<CustomizeTab>("all");
	return (
		<CustomizePage
			section={section}
			customizeCategory={tab}
			onCustomizeCategoryChange={setTab}
			onNavigateSection={setSection}
			onOpenModelProviders={vi.fn()}
		/>
	);
}

let container: HTMLDivElement;
let root: Root;

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
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	mocks.catalog.mockReset().mockResolvedValue(catalog);
	mocks.connectors.mockReset().mockResolvedValue({
		configured: true,
		toolkits: [
			{
				slug: "calendar",
				name: "Calendar",
				categories: ["Productivity"],
				recommended: true,
			},
			{
				slug: "mail",
				name: "Mail",
				categories: ["Communication"],
				recommended: true,
			},
		],
	});
	mocks.connectionStatus = {
		configured: true,
		integrations: ["calendar", "mail"].map((toolkit) => ({
			toolkit,
			name: toolkit === "calendar" ? "Calendar" : "Mail",
			description: "Connected account",
			recommended: true,
			status: "connected",
		})),
	};
	mocks.status.mockReset().mockResolvedValue(mocks.connectionStatus);
	mocks.invoke.mockReset().mockImplementation(async (command: string) => {
		if (command === "list_marketplace_installed_entries")
			return { installedKeys: ["plugin:daily-planner", "plugin:code-review"] };
		if (command === "list_user_instruction_configs")
			return {
				workspaceRoot: "/workspace",
				plugins: [
					{
						id: "daily-planner",
						name: "Daily planner",
						path: "/workspace/plugins/daily-planner",
						enabled: true,
					},
					{
						id: "code-review",
						name: "Code review",
						path: "/workspace/plugins/code-review",
						enabled: true,
					},
				],
			};
		if (command === "list_mcp_servers") return { servers: [] };
		if (command === "list_cli_sessions") return [];
		throw new Error(`Unexpected command: ${command}`);
	});
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

function categoryButton() {
	const buttons = container.querySelectorAll<HTMLButtonElement>(
		'button[aria-label^="Filter by category"]',
	);
	expect(buttons).toHaveLength(1);
	return buttons[0];
}

async function chooseCategory(label: string) {
	await act(async () => {
		categoryButton().dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
	});
	const options = [
		...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
	];
	const option = options.find((item) => item.textContent?.trim() === label);
	expect(option, `Missing category ${label}`).toBeDefined();
	await act(async () => option?.click());
}

async function openPage(label: "Browse" | "Manage") {
	const button = [
		...container.querySelectorAll<HTMLButtonElement>(
			'nav[aria-label="Customize sections"] button',
		),
	].find((item) => item.textContent === label);
	expect(button).toBeDefined();
	await act(async () => button?.click());
}

async function openType(label: string) {
	const pill = [
		...container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
	].find((item) => item.textContent?.startsWith(label));
	expect(pill, `Missing type ${label}`).toBeDefined();
	await act(async () => pill?.click());
}

function expectCard(name: string, present: boolean) {
	const card = container.querySelector(
		`button[aria-label="View ${name} details"], button[aria-label="Open ${name} details"], button[aria-label="Expand ${name}"]`,
	);
	if (present) expect(card, `Missing ${name}`).not.toBeNull();
	else expect(card, `Unexpected ${name}`).toBeNull();
}

async function render(initialPage?: "browse" | "manage") {
	await act(async () =>
		root.render(<CustomizeHarness initialPage={initialPage} />),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("shared Customize category filter", () => {
	it("recovers category options after an initial catalog failure without clearing the selection", async () => {
		mocks.catalog.mockRejectedValue(new Error("Catalog unavailable"));
		await render();
		await chooseCategory("Communication");
		mocks.catalog.mockResolvedValue(catalog);
		await openPage("Browse");
		expect(categoryButton().textContent).toBe("Communication");
		await chooseCategory("Developer tools");
		expectCard("Code review", true);
		expectCard("Daily planner", false);
	});

	it("carries a category selected in Manage through Browse, Plugins, and Connectors", async () => {
		await render();
		expect(categoryButton().textContent).toBe("All categories");
		await chooseCategory("Productivity");
		expect(categoryButton().textContent).toBe("Productivity");
		expectCard("Calendar", true);
		expectCard("Mail", false);
		expectCard("Daily planner", true);
		expectCard("Code review", false);

		await openPage("Browse");
		expect(categoryButton().textContent).toBe("Productivity");
		expectCard("Calendar", true);
		expectCard("Mail", false);
		expectCard("Daily planner", true);
		expectCard("Code review", false);
		expectCard("Debugging", false);

		await openType("Plugins");
		expect(categoryButton().textContent).toBe("Productivity");
		expectCard("Daily planner", true);
		expectCard("Code review", false);
		await openType("Connectors");
		expect(categoryButton().textContent).toBe("Productivity");
		expectCard("Calendar", true);
		expectCard("Mail", false);

		await openPage("Manage");
		expect(categoryButton().textContent).toBe("Productivity");
		expectCard("Calendar", true);
		expectCard("Mail", false);
		await openType("Plugins");
		expect(categoryButton().textContent).toBe("Productivity");
		expectCard("Daily planner", true);
		expectCard("Code review", false);
		await chooseCategory("All categories");
		expectCard("Code review", true);
		await openPage("Browse");
		expect(categoryButton().textContent).toBe("All categories");
		expectCard("Daily planner", true);
		expectCard("Code review", true);
	});

	it("retains a connector-only category on empty Plugins pages until explicitly cleared", async () => {
		await render();
		await chooseCategory("Communication");
		await openType("Plugins");
		expect(categoryButton().textContent).toBe("Communication");
		expectCard("Daily planner", false);
		expectCard("Code review", false);
		await openPage("Browse");
		expect(categoryButton().textContent).toBe("Communication");
		expect(container.textContent).toContain(
			"No entries match the current filters.",
		);
		await chooseCategory("All categories");
		expect(categoryButton().textContent).toBe("All categories");
		expectCard("Daily planner", true);
		expectCard("Code review", true);
	});

	it("restores the selected category after opening and returning from a skill detail page", async () => {
		await render("browse");
		await chooseCategory("Developer tools");
		await openType("Skills");
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="View Debugging details"]',
				)
				?.click(),
		);
		expect(
			container.querySelector('[aria-label="Skill content"]'),
		).not.toBeNull();
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('button[aria-label="Back to Browse"]')
				?.click(),
		);
		expect(categoryButton().textContent).toBe("Developer tools");
		expectCard("Debugging", true);
		await openType("Plugins");
		expectCard("Code review", true);
		expectCard("Daily planner", false);
		await openPage("Manage");
		expect(categoryButton().textContent).toBe("Developer tools");
		expectCard("Code review", true);
		expectCard("Daily planner", false);
	});

	it.each([
		["Calendar", "Connectors", "Manage"],
		["Daily planner", "Plugins", "Manage"],
		["Calendar", "Connectors", "Search"],
		["Daily planner", "Plugins", "Search"],
	] as const)("filters Manage when selecting a category from %s details in %s / %s", async (name, type, origin) => {
		await render();
		await openType(type);
		const search = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search customizations"]',
		);
		if (origin === "Search") {
			await act(async () => {
				Object.getOwnPropertyDescriptor(
					HTMLInputElement.prototype,
					"value",
				)?.set?.call(search, name);
				search?.dispatchEvent(new Event("input", { bubbles: true }));
			});
		}
		const trigger = container.querySelector<HTMLButtonElement>(
			`button[aria-label="View ${name} details"], button[aria-label="Open ${name} details"], button[aria-label="Expand ${name}"]`,
		);
		expect(trigger, `Missing ${name} details trigger`).not.toBeNull();
		const viewport = trigger?.closest<HTMLElement>(
			"[data-radix-scroll-area-viewport]",
		);
		if (viewport) viewport.scrollTop = 320;
		await act(async () => trigger?.click());
		const dialog = document.querySelector('[role="dialog"]');
		const pluginNavigation = container.querySelector(
			'nav[aria-label="Plugin navigation"]',
		);
		if (type === "Plugins") {
			expect(dialog).toBeNull();
			expect(pluginNavigation).not.toBeNull();
			expect(
				pluginNavigation?.querySelector(
					`button[aria-label="Back to ${origin === "Search" ? "Search results" : "Manage"}"]`,
				),
			).not.toBeNull();
		} else {
			expect(dialog).not.toBeNull();
			expect(pluginNavigation).toBeNull();
		}
		const details =
			type === "Plugins" ? pluginNavigation?.parentElement : dialog;
		const category = details?.querySelector<HTMLButtonElement>(
			'button[title="Filter by Productivity"]',
		);
		expect(category, "Missing clickable detail category").not.toBeNull();
		await act(async () => category?.click());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(
			container.querySelector('nav[aria-label="Plugin navigation"]'),
		).toBeNull();
		expect(search?.value).toBe("");
		expect(
			container.querySelector('[aria-label="Installed search results"]'),
		).toBeNull();
		expect(categoryButton().textContent).toBe("Productivity");
		expect(document.activeElement).toBe(categoryButton());
		expect(
			container.querySelector('[role="radio"][aria-checked="true"]')
				?.textContent,
		).toMatch(new RegExp(`^${type}`));
		const returnedCard = container.querySelector(
			`button[aria-label="View ${name} details"], button[aria-label="Open ${name} details"], button[aria-label="Expand ${name}"]`,
		);
		expect(
			returnedCard?.closest<HTMLElement>("[data-radix-scroll-area-viewport]")
				?.scrollTop,
		).toBe(0);
		await openType("All");
		expectCard("Calendar", true);
		expectCard("Daily planner", true);
		expectCard("Mail", false);
		expectCard("Code review", false);
	});
});
