// @vitest-environment jsdom

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	disconnectComposioIntegration,
	resetComposioCacheForTesting,
} from "@/lib/composio";
import type {
	ComposioCatalogResponse,
	ComposioStatusResponse,
} from "@/lib/composio-types";
import {
	commitExtensionInventoryResponse,
	invalidateExtensionInventoryCache,
	type McpServersResponse,
	type UserInstructionListsResponse,
} from "@/lib/extension-inventory";
import type { MarketplaceCatalog } from "@/lib/marketplace";
import { clearMarketplaceInstalledEntries } from "@/lib/marketplace-installed";
import { PageFrame } from "../page-layout";
import { CustomizePage } from "./customize-page";
import {
	type InstalledCustomizationActions,
	InstalledCustomizationSections,
} from "./installed-customization-sections";
import { ManageCustomizationsView } from "./manage-customizations-view";
import type { CustomizeTab } from "./navigation/customize-categories";
import { CustomizationEmptyState } from "./shared/customization-empty-state";
import { useInstalledCustomizations } from "./use-installed-customizations";

type InstalledModel = ReturnType<typeof useInstalledCustomizations>;

/** Category sections are replaced by markers here, so nothing opens a detail page. */
const hostActions: InstalledCustomizationActions = {
	onCreateMcp: () => {},
	onOpenModelProviders: () => {},
	onOpenPlugin: () => {},
	onOpenSkill: () => {},
	onOpenRule: () => {},
	onOpenWorkflow: () => {},
	onOpenMcp: () => {},
};

/** Owns the selected category, as the Customize page does. */
function Manage({ initialTab = "all" }: { initialTab?: CustomizeTab }) {
	const [tab, setTab] = useState(initialTab);
	return (
		<ManageCustomizationsView
			actions={hostActions}
			tab={tab}
			onTabChange={setTab}
		/>
	);
}

function latestModel(observer: {
	mock: { lastCall: [InstalledModel] | undefined };
}) {
	const model = observer.mock.lastCall?.[0];
	if (!model) throw new Error("Installed model has not rendered");
	return model;
}

function InstalledSearch({
	searchQuery,
	onModel,
	renderSections = true,
}: {
	searchQuery: string;
	onModel?: (model: InstalledModel) => void;
	renderSections?: boolean;
}) {
	const model = useInstalledCustomizations({
		searchQuery,
		searchResults: true,
	});
	useEffect(() => {
		onModel?.(model);
	});
	return renderSections ? (
		<InstalledCustomizationSections model={model} actions={hostActions} />
	) : null;
}

type CategoryProps = {
	section?: string;
	searchQuery?: string;
	searchResults?: boolean;
	onInventoryChanged?: () => void;
};

const mocks = vi.hoisted(() => ({
	children: {} as Record<string, CategoryProps>,
	inventory: vi.fn(),
	mcpServers: vi.fn(),
	connectorStatus: vi.fn(),
	connectorCatalog: vi.fn(),
	disconnectConnector: vi.fn(),
	marketplaceCatalog: vi.fn(),
	installedEntries: vi.fn(),
	invoke: vi.fn(),
	invalidateInventory: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: mocks.invoke,
		subscribe: () => () => {},
	},
}));
vi.mock("@/lib/marketplace", () => ({
	fetchMarketplaceCatalog: mocks.marketplaceCatalog,
	getCachedMarketplaceCatalog: () => null,
}));
vi.mock("./connectors/composio-connectors-view", () => ({
	InstalledConnectorsView: (props: CategoryProps) => {
		mocks.children.Connectors = props;
		return <section aria-label="Managed content">Connectors</section>;
	},
	// Manage lists what is installed; the catalog belongs to Browse.
	ConnectorCatalogView: () => (
		<section aria-label="Managed content">Connector catalog</section>
	),
}));
vi.mock("@/lib/extension-inventory", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/extension-inventory")>();
	return {
		...actual,
		invalidateExtensionInventoryCache:
			mocks.invalidateInventory.mockImplementation(
				actual.invalidateExtensionInventoryCache,
			),
	};
});
vi.mock("./extensions/skills-section", () => ({
	SkillsSection: (props: CategoryProps) => {
		mocks.children.Skills = props;
		return <section aria-label="Managed content">Skills</section>;
	},
}));
vi.mock("./extensions/plugins-section", () => ({
	PluginsSection: (props: CategoryProps) => {
		mocks.children.Plugins = props;
		return <section aria-label="Managed content">Plugins</section>;
	},
}));
vi.mock("./extensions/rules-section", () => ({
	RulesSection: (props: CategoryProps) => {
		mocks.children.Rules = props;
		return <section aria-label="Managed content">Rules</section>;
	},
}));
vi.mock("./extensions/hooks-section", () => ({
	HooksSection: (props: CategoryProps) => {
		mocks.children.Hooks = props;
		return <section aria-label="Managed content">Hooks</section>;
	},
}));
vi.mock("./extensions/tools-section", () => ({
	ToolsSection: (props: CategoryProps) => {
		mocks.children.Tools = props;
		return <section aria-label="Managed content">Tools</section>;
	},
}));
vi.mock("./mcp/mcp-view", () => ({
	McpServersContent: (props: CategoryProps) => {
		mocks.children.MCP = props;
		return <section aria-label="Managed content">MCP</section>;
	},
}));

const EMPTY_CATALOG: MarketplaceCatalog = {
	version: 1,
	counts: { total: 0, plugins: 0, skills: 0, mcps: 0 },
	tags: [],
	entries: [],
};

function inventoryFixture(): UserInstructionListsResponse {
	return {
		workspaceRoot: "/workspace",
		plugins: [
			{
				id: "repository",
				name: "Repository helpers",
				path: "/workspace/.cline/plugins/repository",
				enabled: true,
				source: "workspace-plugin",
			},
		],
		skills: [
			{
				name: "calendar-planning",
				description: "Plan calendar events",
				instructions: "Plan upcoming meetings",
				path: "/workspace/.agents/skills/calendar-planning/SKILL.md",
				enabled: true,
			},
		],
		workflows: [
			{
				id: "release-notes",
				name: "Release notes",
				instructions: "Summarize this release",
				path: "/workspace/.clinerules/workflows/release.md",
			},
		],
		agents: [],
		rules: [],
		hooks: [],
		tools: [
			{
				id: "calendar-events",
				name: "Calendar events",
				enabled: true,
				source: "workspace-plugin",
			},
			{
				id: "repository-search",
				name: "Repository search",
				enabled: true,
				source: "workspace-plugin",
			},
		],
		mcp: {
			settingsPath: "/workspace/.cline/mcp.json",
			hasSettingsFile: true,
			servers: [
				{
					name: "filesystem",
					transportType: "stdio",
					disabled: false,
					command: "filesystem-server",
				},
			],
		},
		warnings: [],
	};
}

const CONNECTOR_STATUS: ComposioStatusResponse = {
	configured: true,
	integrations: [
		{
			toolkit: "googlecalendar",
			name: "Google Calendar",
			description: "Calendar events",
			recommended: true,
			status: "connected",
		},
		{
			toolkit: "gmail",
			name: "Gmail",
			description: "Email",
			recommended: true,
			status: "not_connected",
		},
	],
};
const CONNECTOR_CATALOG: ComposioCatalogResponse = {
	configured: true,
	toolkits: [
		{
			slug: "googlecalendar",
			name: "Google Calendar",
			description: "Calendar events",
			recommended: true,
			categories: ["Productivity"],
		},
	],
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	invalidateExtensionInventoryCache();
	clearMarketplaceInstalledEntries();
	resetComposioCacheForTesting();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	mocks.children = {};
	mocks.inventory.mockReset().mockResolvedValue(inventoryFixture());
	mocks.mcpServers.mockReset().mockResolvedValue(inventoryFixture().mcp);
	mocks.connectorStatus.mockReset().mockResolvedValue(CONNECTOR_STATUS);
	mocks.connectorCatalog.mockReset().mockResolvedValue(CONNECTOR_CATALOG);
	mocks.disconnectConnector
		.mockReset()
		.mockResolvedValue({ configured: true, integrations: [] });
	mocks.marketplaceCatalog.mockReset().mockResolvedValue(EMPTY_CATALOG);
	mocks.installedEntries.mockReset().mockResolvedValue({ installedKeys: [] });
	mocks.invoke
		.mockReset()
		.mockImplementation((command: string, args?: { operation?: string }) => {
			if (command === "list_user_instruction_configs") return mocks.inventory();
			if (command === "list_marketplace_installed_entries")
				return mocks.installedEntries();
			if (command === "list_mcp_servers") return mocks.mcpServers();
			if (command === "composio_integrations") {
				if (args?.operation === "status") return mocks.connectorStatus();
				if (args?.operation === "listToolkits") return mocks.connectorCatalog();
				if (args?.operation === "disconnect")
					return mocks.disconnectConnector();
			}
			return Promise.reject(new Error(`Unexpected command: ${command}`));
		});
	mocks.invalidateInventory.mockClear();
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	resetComposioCacheForTesting();
	vi.unstubAllGlobals();
});

const CATEGORY_LABELS = [
	"Connectors",
	"Plugins",
	"Skills",
	"MCP",
	"Tools",
	"Rules",
	"Hooks",
];

const INSTALLED_CATEGORY_LABELS = [
	"Connectors",
	"Plugins",
	"Skills",
	"MCP",
	"Tools",
];

function managedContent() {
	return [...container.querySelectorAll('[aria-label="Managed content"]')]
		.filter((section) => !section.closest("[hidden]"))
		.map((section) => section.textContent);
}

function categoryPills() {
	return [
		...container.querySelectorAll<HTMLButtonElement>(
			'[aria-label="Manage categories"] [role="radio"]',
		),
	];
}

async function renderManage(initialTab?: "connectors") {
	await act(async () => {
		root.render(<Manage initialTab={initialTab} />);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("Manage categories", () => {
	it("previews the empty state in the page without reading installed inventory", async () => {
		await act(async () => {
			root.render(
				<CustomizePage
					section="manage"
					customizeCategory="all"
					onCustomizeCategoryChange={() => {}}
					onNavigateSection={() => {}}
					onOpenModelProviders={() => {}}
					manageContent={
						<CustomizationEmptyState
							illustrated
							itemLabel="customizations"
							message="Extend what Cline can do with customizations."
							marketplaceType={null}
						/>
					}
				/>,
			);
		});

		expect(container.querySelector("h1")?.textContent).toBe("Customize");
		expect(container.querySelector("h2")?.textContent).toBe("Manage");
		expect(
			container.querySelector("[data-customization-illustration]"),
		).not.toBeNull();
		expect(container.textContent).toContain("Browse customizations");
		expect(managedContent()).toEqual([]);
		expect(mocks.inventory).not.toHaveBeenCalled();
		expect(mocks.mcpServers).not.toHaveBeenCalled();
	});

	it("uses one page frame and one Manage heading in the real Customize page", async () => {
		await act(async () => {
			root.render(
				<CustomizePage
					section="manage"
					customizeCategory="all"
					onCustomizeCategoryChange={() => {}}
					onNavigateSection={() => {}}
					onOpenModelProviders={() => {}}
				/>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(
			[...container.querySelectorAll("h1")].map(
				(heading) => heading.textContent,
			),
		).toEqual(["Customize"]);
		expect(
			[...container.querySelectorAll("h2")].map(
				(heading) => heading.textContent,
			),
		).toEqual(["Manage"]);
		expect(
			[...container.querySelectorAll("span")].filter(
				(paragraph) =>
					paragraph.textContent ===
					"Extend what Cline can do and how it works.",
			),
		).toHaveLength(1);
		const viewports = container.querySelectorAll(
			'[data-slot="scroll-area-viewport"]',
		);
		expect(viewports).toHaveLength(1);
		expect(
			container.querySelectorAll('[aria-label="Manage categories"]'),
		).toHaveLength(1);
		for (const section of container.querySelectorAll(
			'[aria-label="Managed content"]',
		)) {
			expect(section.closest('[data-slot="scroll-area-viewport"]')).toBe(
				viewports[0],
			);
		}
		expect(managedContent()).toEqual(INSTALLED_CATEGORY_LABELS);
	});

	it("lets the shared page viewport scroll the categories and installed inventory", async () => {
		await act(async () => {
			root.render(
				<PageFrame header={{ title: "Customize" }}>
					<Manage />
				</PageFrame>,
			);
		});
		const viewports = container.querySelectorAll(
			'[data-slot="scroll-area-viewport"]',
		);
		expect(viewports).toHaveLength(1);
		expect(
			container
				.querySelector('[aria-label="Manage categories"]')
				?.closest('[data-slot="scroll-area-viewport"]'),
		).toBe(viewports[0]);
		for (const section of container.querySelectorAll(
			'[aria-label="Managed content"]',
		)) {
			expect(section.closest('[data-slot="scroll-area-viewport"]')).toBe(
				viewports[0],
			);
		}

		const skills = categoryPills().find((pill) =>
			pill.textContent?.startsWith("Skills"),
		);
		if (!skills) throw new Error("Missing Skills category");
		await act(async () => skills.click());
		expect(managedContent()).toEqual(["Skills"]);
		expect(
			container.querySelectorAll('[data-slot="scroll-area-viewport"]'),
		).toHaveLength(1);
	});

	it("renders inventory content without adding a page header or scroll viewport", async () => {
		await act(async () => root.render(<Manage />));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(container.querySelector("h1")).toBeNull();
		expect(
			container.querySelectorAll('[data-slot="scroll-area-viewport"]'),
		).toHaveLength(0);
		expect(managedContent()).toEqual(INSTALLED_CATEGORY_LABELS);
	});

	it("renders the shared category and reports selection and clearing to its owner", async () => {
		const onTabChange = vi.fn();
		const render = async (tab: CustomizeTab) => {
			await act(async () => {
				root.render(
					<ManageCustomizationsView
						actions={hostActions}
						onTabChange={onTabChange}
						tab={tab}
					/>,
				);
			});
		};
		await render("skills");
		expect(managedContent()).toEqual(["Skills"]);
		const skills = categoryPills().find((pill) =>
			pill.textContent?.startsWith("Skills"),
		)!;
		const plugins = categoryPills().find((pill) =>
			pill.textContent?.startsWith("Plugins"),
		)!;
		await act(async () => plugins.click());
		expect(onTabChange).toHaveBeenLastCalledWith("plugins");
		expect(skills.getAttribute("aria-checked")).toBe("true");
		await render("plugins");
		expect(managedContent()).toEqual(["Plugins"]);
		expect(plugins.getAttribute("aria-checked")).toBe("true");
		await act(async () => plugins.click());
		expect(onTabChange).toHaveBeenLastCalledWith("all");
		expect(plugins.getAttribute("aria-checked")).toBe("true");
		await render("all");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(categoryPills()[0].getAttribute("aria-checked")).toBe("true");
		expect(managedContent()).toEqual(INSTALLED_CATEGORY_LABELS);
	});

	it("defaults to All with nonempty inventory sections, retaining every category pill and Beta", async () => {
		await renderManage();
		const filters = categoryPills();
		expect(filters.map((filter) => filter.textContent)).toEqual([
			"All",
			"ConnectorsBeta",
			"Plugins",
			"Skills",
			"MCP",
			"Tools",
			"Rules",
			"Hooks",
		]);
		expect(filters[0].getAttribute("aria-checked")).toBe("true");
		expect(managedContent()).toEqual(INSTALLED_CATEGORY_LABELS);
		// Each category owns its shared heading and actions; the hub must not duplicate it.
		expect(container.querySelectorAll("h3")).toHaveLength(0);

		await act(async () => filters[0].click());
		expect(filters[0].getAttribute("aria-checked")).toBe("true");
		expect(managedContent()).toEqual(INSTALLED_CATEGORY_LABELS);
	});

	it("filters to each category and returns to All when it is clicked again", async () => {
		await renderManage();
		const [all, ...categories] = categoryPills();
		for (const [index, category] of categories.entries()) {
			await act(async () => category.click());
			expect(category.getAttribute("aria-checked")).toBe("true");
			expect(all.getAttribute("aria-checked")).toBe("false");
			expect(managedContent()).toEqual([CATEGORY_LABELS[index]]);

			await act(async () => category.click());
			expect(all.getAttribute("aria-checked")).toBe("true");
			expect(category.getAttribute("aria-checked")).toBe("false");
			expect(managedContent()).toEqual(INSTALLED_CATEGORY_LABELS);
			expect(
				container.querySelectorAll(
					'[aria-label="Manage categories"] [aria-checked="true"]',
				),
			).toHaveLength(1);
		}
	});

	it("keeps connector shortcuts and All limited to installed connector content", async () => {
		await renderManage("connectors");
		const [all, connectors] = categoryPills();
		expect(connectors.getAttribute("aria-checked")).toBe("true");
		expect(managedContent()).toEqual(["Connectors"]);

		await act(async () => all.click());
		expect(all.getAttribute("aria-checked")).toBe("true");
		expect(managedContent()).toEqual(INSTALLED_CATEGORY_LABELS);
	});
});

describe("Installed Customize search", () => {
	it("resolves partial counts, loading, and errors without mounting category views", async () => {
		const inventory = deferred<UserInstructionListsResponse>();
		const status = deferred<ComposioStatusResponse>();
		const catalog = deferred<ComposioCatalogResponse>();
		mocks.inventory.mockReturnValue(inventory.promise);
		mocks.connectorStatus.mockReturnValue(status.promise);
		mocks.connectorCatalog.mockReturnValue(catalog.promise);
		const onModel = vi.fn<(model: InstalledModel) => void>();
		const latest = () => latestModel(onModel);
		await act(async () =>
			root.render(
				<InstalledSearch
					searchQuery="  CALENDAR  "
					onModel={onModel}
					renderSections={false}
				/>,
			),
		);
		expect(latest().summary).toEqual({
			query: "calendar",
			count: 0,
			loading: true,
			error: false,
		});

		await act(async () => inventory.resolve(inventoryFixture()));
		expect(latest().summary).toEqual({
			query: "calendar",
			count: 2,
			loading: true,
			error: false,
		});
		expect(latest().searchStates.skills.count).toBe(1);
		expect(latest().searchStates.tools.count).toBe(1);

		await act(async () => status.resolve(CONNECTOR_STATUS));
		expect(latest().summary).toEqual({
			query: "calendar",
			count: 3,
			loading: true,
			error: false,
		});
		await act(async () =>
			catalog.reject(new Error("Connector catalog unavailable")),
		);
		expect(latest().summary).toEqual({
			query: "calendar",
			count: 3,
			loading: false,
			error: true,
		});
		expect(latest().searchStates.connectors.error).toBe(true);
		expect(Object.keys(mocks.children)).toEqual([]);
		expect(container.innerHTML).toBe("");

		await act(async () =>
			root.render(
				<InstalledSearch searchQuery="  CALENDAR  " onModel={onModel} />,
			),
		);
		expect(managedContent()).toEqual(["Connectors", "Skills", "Tools"]);
		expect(categoryPills()).toHaveLength(0);
		expect(
			container.querySelectorAll('[data-slot="scroll-area-viewport"]'),
		).toHaveLength(0);
		for (const label of ["Connectors", "Skills", "Tools"]) {
			expect(mocks.children[label]).toMatchObject({
				searchQuery: "  CALENDAR  ",
				searchResults: true,
			});
			expect(mocks.children[label]).not.toHaveProperty("onSearchStateChange");
		}
	});

	it("reports inventory failures without hiding independently loaded connectors", async () => {
		mocks.inventory.mockRejectedValue(
			new Error("Could not read installed files"),
		);
		const onModel = vi.fn<(model: InstalledModel) => void>();
		await act(async () =>
			root.render(
				<InstalledSearch
					searchQuery="calendar"
					onModel={onModel}
					renderSections={false}
				/>,
			),
		);
		const model = latestModel(onModel);
		expect(model.summary).toEqual({
			query: "calendar",
			count: 1,
			loading: false,
			error: true,
		});
		expect(model.searchStates.connectors).toEqual({
			query: "calendar",
			count: 1,
			loading: false,
			error: false,
		});
		expect(model.searchStates.skills.error).toBe(true);
		expect(Object.keys(mocks.children)).toEqual([]);
	});

	it("uses the dedicated MCP response for headless counts even when full inventory is cached", async () => {
		commitExtensionInventoryResponse(inventoryFixture());
		const servers = deferred<McpServersResponse>();
		mocks.mcpServers.mockReturnValue(servers.promise);
		const onModel = vi.fn<(model: InstalledModel) => void>();
		await act(async () =>
			root.render(
				<InstalledSearch
					searchQuery="new-calendar"
					onModel={onModel}
					renderSections={false}
				/>,
			),
		);
		expect(latestModel(onModel).searchStates.mcp).toMatchObject({
			count: 0,
			loading: true,
			error: false,
		});
		await act(async () =>
			servers.resolve({
				settingsPath: "/workspace/.cline/mcp.json",
				hasSettingsFile: true,
				servers: [
					{
						name: "new-calendar",
						transportType: "stdio",
						disabled: false,
						command: "calendar-server",
					},
				],
			}),
		);
		expect(latestModel(onModel).summary).toEqual({
			query: "new-calendar",
			count: 1,
			loading: false,
			error: false,
		});
		expect(latestModel(onModel).searchStates.mcp.count).toBe(1);
		expect(mocks.inventory).not.toHaveBeenCalled();
		expect(Object.keys(mocks.children)).toEqual([]);
	});

	it("retains MCP load failures in the headless summary when there are no matching items", async () => {
		mocks.mcpServers.mockRejectedValue(new Error("MCP settings unavailable"));
		const onModel = vi.fn<(model: InstalledModel) => void>();
		await act(async () =>
			root.render(
				<InstalledSearch
					searchQuery="missing"
					onModel={onModel}
					renderSections={false}
				/>,
			),
		);
		expect(latestModel(onModel).searchStates.mcp).toEqual({
			query: "missing",
			count: 0,
			loading: false,
			error: true,
		});
		expect(latestModel(onModel).summary).toEqual({
			query: "missing",
			count: 0,
			loading: false,
			error: true,
		});
		expect(Object.keys(mocks.children)).toEqual([]);
	});

	it("derives counts for the new query immediately while an earlier catalog read finishes", async () => {
		const catalog = deferred<MarketplaceCatalog>();
		mocks.marketplaceCatalog.mockReturnValue(catalog.promise);
		mocks.installedEntries.mockResolvedValue({
			installedKeys: ["skill:calendar-sync"],
		});
		const onModel = vi.fn<(model: InstalledModel) => void>();
		const render = (searchQuery: string) =>
			root.render(
				<InstalledSearch
					searchQuery={searchQuery}
					onModel={onModel}
					renderSections={false}
				/>,
			);
		await act(async () => render("calendar"));
		expect(latestModel(onModel).summary).toEqual({
			query: "calendar",
			count: 3,
			loading: true,
			error: false,
		});
		onModel.mockClear();
		await act(async () => render("repository"));
		expect(latestModel(onModel).summary).toEqual({
			query: "repository",
			count: 2,
			loading: true,
			error: false,
		});
		await act(async () =>
			catalog.resolve({
				...EMPTY_CATALOG,
				counts: { total: 1, plugins: 0, skills: 1, mcps: 0 },
				entries: [
					{
						id: "calendar-sync",
						type: "skill",
						name: "Calendar synchronization",
						tagline: "Synchronize calendar appointments",
						description: "Keep appointments up to date",
						tags: [],
						install: {
							command: "cline install skill",
							args: ["calendar-sync"],
						},
					},
				],
			}),
		);
		expect(latestModel(onModel).summary).toEqual({
			query: "repository",
			count: 2,
			loading: false,
			error: false,
		});
		for (const [model] of onModel.mock.calls) {
			expect(model.summary).toMatchObject({ query: "repository", count: 2 });
		}
		expect(Object.keys(mocks.children)).toEqual([]);
	});

	it("updates visible categories when inventory is published without child reports", async () => {
		await renderManage();
		expect(managedContent()).toEqual(INSTALLED_CATEGORY_LABELS);
		mocks.inventory.mockClear();
		mocks.mcpServers.mockResolvedValue({
			settingsPath: "",
			hasSettingsFile: false,
			servers: [],
		});
		await act(async () =>
			commitExtensionInventoryResponse({
				...inventoryFixture(),
				plugins: [],
				skills: [],
				workflows: [],
				tools: [],
				mcp: { settingsPath: "", hasSettingsFile: false, servers: [] },
				rules: [
					{
						name: "Team conventions",
						instructions: "Follow team conventions",
						path: "/workspace/.clinerules/team.md",
					},
				],
			}),
		);
		expect(managedContent()).toEqual(["Connectors", "Rules"]);
		expect(mocks.inventory).not.toHaveBeenCalled();
	});

	it("refreshes contributed inventory after a connector mutation and uses its shared status", async () => {
		await renderManage();
		expect(mocks.children.Connectors.onInventoryChanged).toBeUndefined();
		mocks.invalidateInventory.mockClear();
		mocks.inventory
			.mockClear()
			.mockResolvedValue({ ...inventoryFixture(), tools: [] });
		mocks.connectorStatus
			.mockClear()
			.mockResolvedValue({ configured: true, integrations: [] });
		await act(async () => {
			await disconnectComposioIntegration("googlecalendar");
		});
		expect(managedContent()).toEqual(["Plugins", "Skills", "MCP"]);
		expect(mocks.invalidateInventory).toHaveBeenCalledOnce();
		expect(mocks.inventory).toHaveBeenCalledOnce();
	});
});

describe("cached Customize counts", () => {
	it("keeps empty inventory sections hidden on remount without rescanning", async () => {
		await renderManage();
		const previousContent = managedContent();
		await act(async () => root.render(null));
		mocks.invoke.mockClear();
		await act(async () => root.render(<Manage />));
		expect(managedContent()).toEqual(previousContent);
		expect(mocks.invoke).not.toHaveBeenCalled();
	});
});
