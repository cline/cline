// @vitest-environment jsdom

import { act, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	filterBuiltinInventory,
	invalidateExtensionInventoryCache,
} from "@/lib/extension-inventory";
import { clearMarketplaceInstalledEntries } from "@/lib/marketplace-installed";
import { revealActionLabel } from "@/lib/reveal-label";
import { useExtensionInventory } from "@/lib/use-extension-inventory";
import {
	type CustomizationDetailSelection,
	CustomizationDetailView,
} from "../customization-detail-view";
import { useInstalledMarketplaceItems } from "../marketplace/use-installed-marketplace-items";
import {
	CustomizeRefreshButton,
	CustomizeRefreshProvider,
} from "../shared/customize-refresh";
import type { ExtensionSectionProps } from "./extension-section-shared";
import { HooksSection } from "./hooks-section";
import {
	getInstalledCommands,
	getScopedPlugins,
	pluginMarketplaceItem,
	skillMarketplaceItem,
} from "./installed-marketplace-selectors";
import type { InstalledPluginSelection } from "./installed-plugin-detail";
import type { InstalledSkillSelection } from "./installed-skill-detail";
import { PluginsSection } from "./plugins-section";
import { RulesSection } from "./rules-section";
import { SkillsSection } from "./skills-section";
import { ToolsSection } from "./tools-section";
import type { WorkflowSelection } from "./workflow-detail-page";

type SectionHostProps = ExtensionSectionProps & {
	section?: "Rules" | "Hooks" | "Skills" | "Plugins" | "Tools";
	onOpenWorkflow?: (
		selection: WorkflowSelection,
		trigger?: HTMLButtonElement,
	) => void;
	onOpenSkill?: (
		selection: InstalledSkillSelection,
		trigger?: HTMLButtonElement,
	) => void;
	onOpenPlugin?: (
		selection: InstalledPluginSelection,
		trigger?: HTMLButtonElement,
	) => void;
	onOpenModelProviders?: () => void;
};

/** The catalog matches the Customize page resolves before rendering a section. */
function useSectionMarketplaceModel(
	primitive: "skill" | "plugin",
	{ includeBuiltinItems = true, searchQuery, searchResults }: SectionHostProps,
) {
	const { inventory, refresh } = useExtensionInventory();
	const installedItems = useMemo(() => {
		if (!inventory) return [];
		const visible = filterBuiltinInventory(inventory, includeBuiltinItems);
		return primitive === "skill"
			? getInstalledCommands(visible).map(skillMarketplaceItem)
			: getScopedPlugins(visible).map(({ plugin }) =>
					pluginMarketplaceItem(plugin),
				);
	}, [inventory, includeBuiltinItems, primitive]);
	return useInstalledMarketplaceItems({
		installedItems,
		onInstalledItemsChanged: () => void refresh(),
		primitive,
		searchQuery,
		searchResults,
	});
}

type OpenDetail = (
	selection: CustomizationDetailSelection,
	trigger?: HTMLButtonElement,
) => void;

function SkillsHost({
	openDetail,
	onOpenSkill,
	onOpenWorkflow,
	...props
}: SectionHostProps & { openDetail: OpenDetail }) {
	return (
		<SkillsSection
			{...props}
			marketplaceModel={useSectionMarketplaceModel("skill", props)}
			onOpenSkill={
				onOpenSkill ??
				((selection, trigger) =>
					openDetail({ type: "skill", selection }, trigger))
			}
			onOpenWorkflow={
				onOpenWorkflow ??
				((selection, trigger) =>
					openDetail({ type: "workflow", selection }, trigger))
			}
		/>
	);
}

function PluginsHost({
	openDetail,
	onOpenPlugin,
	...props
}: SectionHostProps & { openDetail: OpenDetail }) {
	return (
		<PluginsSection
			{...props}
			marketplaceModel={useSectionMarketplaceModel("plugin", props)}
			onOpenPlugin={
				onOpenPlugin ??
				((selection, trigger) =>
					openDetail({ type: "plugin", selection }, trigger))
			}
		/>
	);
}

/**
 * Stands in for the Customize page: it resolves a section's catalog matches
 * and shows the detail page a card opens, returning focus to that card.
 */
function CustomizationSectionView({
	section = "Rules",
	...props
}: SectionHostProps) {
	const [detail, setDetail] = useState<{
		selection: CustomizationDetailSelection;
		trigger?: HTMLButtonElement;
	} | null>(null);
	const returnFocusTo = useRef<HTMLButtonElement | null>(null);
	useLayoutEffect(() => {
		if (detail) return;
		returnFocusTo.current?.focus({ preventScroll: true });
		returnFocusTo.current = null;
	}, [detail]);
	const openDetail: OpenDetail = (selection, trigger) =>
		setDetail({ selection, trigger });
	return (
		<>
			<div hidden={detail !== null}>
				{section === "Skills" ? (
					<SkillsHost {...props} openDetail={openDetail} />
				) : section === "Plugins" ? (
					<PluginsHost {...props} openDetail={openDetail} />
				) : section === "Rules" ? (
					<RulesSection
						{...props}
						onOpenRule={(selection, trigger) =>
							openDetail({ type: "rule", selection }, trigger)
						}
					/>
				) : section === "Hooks" ? (
					<HooksSection {...props} />
				) : (
					<ToolsSection {...props} />
				)}
			</div>
			{detail ? (
				<CustomizationDetailView
					selection={detail.selection}
					backLabel="Manage"
					onBack={(options) => {
						returnFocusTo.current = options?.uninstalled
							? null
							: (detail.trigger ?? null);
						setDetail(null);
					}}
				/>
			) : null}
		</>
	);
}

const { fetchMarketplaceCatalog, invoke } = vi.hoisted(() => ({
	fetchMarketplaceCatalog: vi.fn(),
	invoke: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe: () => () => {} },
	openExternalUrl: vi.fn(),
}));

vi.mock("@/lib/marketplace", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/marketplace")>()),
	fetchMarketplaceCatalog,
}));

const EMPTY_CATALOG = {
	version: 1,
	counts: { total: 0, plugins: 0, skills: 0, mcps: 0 },
	tags: [],
	entries: [],
};

const AGENT_PLUGIN = {
	id: "agent-plugin:/Users/test/.agents/plugins/example",
	name: "agent-plugins-example",
	path: "/Users/test/.agents/plugins/example",
	enabled: true,
	source: "agent-plugin",
	toggleable: true,
	agentPlugin: true,
	contributions: {
		inspectionStatus: "available",
		capabilities: ["skills"],
		tools: [],
		skills: ["example-skill"],
		rules: [],
		hooks: [],
		commands: [],
		mcpServers: [],
		providers: [],
	},
};

const AGENT_PLUGIN_SKILL = {
	name: "example-skill",
	description: "A skill contributed by an Agent Plugin.",
	instructions: "",
	path: "/Users/test/.agents/plugins/example/skills/example-skill/SKILL.md",
	agentPlugin: true,
	pluginName: "agent-plugins-example",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	clearMarketplaceInstalledEntries();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	invalidateExtensionInventoryCache();
	fetchMarketplaceCatalog.mockReset();
	fetchMarketplaceCatalog.mockResolvedValue(EMPTY_CATALOG);
	invoke.mockReset();
	invoke.mockImplementation((command: string) => {
		if (command === "list_marketplace_installed_entries") {
			return Promise.resolve({ installedKeys: [] });
		}
		if (command === "list_user_instruction_configs") {
			return Promise.resolve({
				workspaceRoot: "/workspace",
				rules: [],
				workflows: [],
				skills: [AGENT_PLUGIN_SKILL],
				agents: [],
				plugins: [AGENT_PLUGIN],
				tools: [],
				hooks: [],
				mcp: { servers: [] },
				warnings: [],
			});
		}
		return Promise.reject(new Error(`Unexpected command: ${command}`));
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	invalidateExtensionInventoryCache();
	vi.unstubAllGlobals();
});

async function revealPathFromMenu(
	label: string,
	path: string,
	detailSelector = '[role="dialog"]',
) {
	const trigger = document.querySelector<HTMLButtonElement>(
		`[aria-label="${label} actions"]`,
	);
	expect(trigger).not.toBeNull();
	await act(async () =>
		trigger?.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		),
	);
	const reveal = [
		...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	].find((item) => item.textContent === revealActionLabel());
	expect(reveal).toBeDefined();
	invoke.mockResolvedValueOnce(undefined);
	await act(async () => reveal?.click());
	expect(invoke).toHaveBeenLastCalledWith("reveal_path", { path });
	expect(document.querySelector('[role="menu"]')).toBeNull();
	expect(document.querySelector(detailSelector)).not.toBeNull();
}

describe("host-owned customization search", () => {
	const inventory = {
		workspaceRoot: "/workspace",
		rules: [
			{
				name: "Code conventions",
				path: "/workspace/.cline/rules/style.md",
				instructions: "Prefer accessible components.",
			},
			{
				name: "Commit conventions",
				path: "/workspace/.cline/rules/commits.md",
				instructions: "Keep commit messages concise.",
			},
		],
		hooks: [
			{
				fileName: "validate.ts",
				path: "/workspace/.clinerules/hooks/validate.ts",
				hookEventName: "PreToolUse",
			},
			{
				fileName: "cleanup.ts",
				path: "/workspace/.clinerules/hooks/cleanup.ts",
				hookEventName: "SessionEnd",
			},
		],
		skills: [AGENT_PLUGIN_SKILL],
		workflows: [
			{
				id: "deploy",
				name: "Deploy release",
				instructions: "Perform the moonwalk deployment procedure.",
				path: "/workspace/.cline/workflows/deploy.md",
			},
		],
		plugins: [
			{ ...AGENT_PLUGIN, description: "Accessibility inspection utilities" },
		],
		tools: [
			{
				id: "search",
				name: "Find content",
				enabled: true,
				source: "builtin",
				description: "Look through documents",
				headlessToolNames: ["content_lookup"],
			},
		],
		agents: [],
		mcp: { servers: [] },
		warnings: [],
	};
	beforeEach(() => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs") return inventory;
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			if (command === "list_cli_sessions") return [];
			throw new Error(`Unexpected command: ${command}`);
		});
	});
	it.each([
		{
			section: "Skills" as const,
			primitive: "skill" as const,
			shared: false,
		},
		{ section: "Rules" as const, primitive: undefined, shared: false },
		{ section: "Skills" as const, primitive: "skill" as const, shared: true },
		{ section: "Rules" as const, primitive: undefined, shared: true },
		{ section: "Hooks" as const, primitive: undefined, shared: true },
	])("shows a single counted $section heading with a refresh action in embedded inventory", async ({
		section,
		shared,
	}) => {
		await act(async () =>
			root.render(
				<CustomizeRefreshProvider enabled={shared}>
					<CustomizeRefreshButton />
					<CustomizationSectionView section={section} searchQuery="" />
				</CustomizeRefreshProvider>,
			),
		);
		await vi.waitFor(() =>
			expect(
				container.querySelector('[data-slot="section-heading-count"]')
					?.textContent,
			).toBe("2"),
		);
		expect(
			[...container.querySelectorAll("h2, h3")].map(
				(heading) => heading.textContent,
			),
		).toEqual([section]);
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			2,
		);
		const refresh = container.querySelector<HTMLButtonElement>(
			shared
				? '[aria-label="Refresh customizations"]'
				: `[aria-label="Refresh ${section.toLowerCase()}"]`,
		);
		expect(refresh).not.toBeNull();
		if (shared) {
			expect(
				container.querySelector(
					`[aria-label="Refresh ${section.toLowerCase()}"]`,
				),
			).toBeNull();
		} else {
			expect(
				refresh?.closest('[data-slot="section-heading-actions"]'),
			).not.toBeNull();
		}
		invoke.mockClear();
		await act(async () => refresh?.click());
		expect(invoke).toHaveBeenCalledWith("list_user_instruction_configs");
		if (section === "Hooks")
			expect(invoke).toHaveBeenCalledWith("list_cli_sessions", { limit: 300 });
	});
	it("includes installed marketplace fallback cards in the category heading count", async () => {
		fetchMarketplaceCatalog.mockResolvedValue({
			...EMPTY_CATALOG,
			entries: [
				{
					id: "fallback-skill",
					type: "skill",
					name: "Fallback skill",
					tags: [],
					install: { command: "", args: [] },
				},
			],
		});
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs")
				return { ...inventory, skills: [], workflows: [] };
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: ["skill:fallback-skill"] };
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(<CustomizationSectionView section="Skills" searchQuery="" />),
		);
		await vi.waitFor(() =>
			expect(
				container.querySelector('[data-slot="section-heading-count"]')
					?.textContent,
			).toBe("1"),
		);
		expect(
			container.querySelector('[data-slot="item-card"]')?.textContent,
		).toContain("Fallback skill");
	});
	it("omits the category count for a partial inventory", async () => {
		invoke.mockImplementation(async () => ({
			...inventory,
			warnings: ["Some rules could not be read."],
		}));
		await act(async () =>
			root.render(<CustomizationSectionView section="Rules" searchQuery="" />),
		);
		await vi.waitFor(() =>
			expect(container.textContent).toContain("Some rules could not be read."),
		);
		expect(
			container.querySelector('[data-slot="section-heading-count"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-slot="section-heading-title"]')
				?.textContent,
		).toBe("Rules");
	});
	it.each([
		{ section: "Rules" as const, primitive: undefined },
		{ section: "Skills" as const, primitive: "skill" as const },
	])("keeps partial inventory warnings visible in empty $section results", async ({
		section,
	}) => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs")
				return {
					...inventory,
					warnings: ["Some customization directories could not be read."],
				};
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(
				<CustomizationSectionView
					section={section}
					searchQuery="unavailable-item"
					searchResults
				/>,
			),
		);
		await vi.waitFor(() =>
			expect(container.textContent).toContain("Partial results"),
		);
		expect(container.querySelector('[data-slot="item-card"]')).toBeNull();
		expect(container.textContent).toContain(
			"Some customization directories could not be read.",
		);
	});
	it.each([
		{
			section: "Rules" as const,
			query: " ACCESSIBLE ",
			expected: "Code conventions",
			absent: "Commit conventions",
		},
		{
			section: "Rules" as const,
			query: "commits.md",
			expected: "Commit conventions",
			absent: "Code conventions",
		},
		{
			section: "Hooks" as const,
			query: "pretooluse",
			expected: "validate.ts",
			absent: "cleanup.ts",
		},
		{
			section: "Hooks" as const,
			query: "/hooks/cleanup",
			expected: "cleanup.ts",
			absent: "validate.ts",
		},
		{
			section: "Tools" as const,
			query: "content_lookup",
			expected: "Find content",
			absent: "No plugin tools found.",
		},
	])("filters $section by content and renders nothing without a match", async ({
		section,
		query,
		expected,
		absent,
	}) => {
		await act(async () =>
			root.render(
				<CustomizationSectionView
					section={section}
					searchQuery={query}
					searchResults
				/>,
			),
		);
		await vi.waitFor(() => expect(container.textContent).toContain(expected));
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			1,
		);
		expect(container.textContent).not.toContain(absent);
		expect(container.querySelector('input[type="text"]')).toBeNull();
		await act(async () =>
			root.render(
				<CustomizationSectionView
					section={section}
					searchQuery="nothing-matches"
					searchResults
				/>,
			),
		);
		expect(container.textContent).toBe("");
	});
	it.each([
		{
			section: "Skills" as const,
			primitive: "skill" as const,
			query: "contributed",
			expected: "example-skill",
		},
		{
			section: "Skills" as const,
			primitive: "skill" as const,
			query: "moonwalk",
			expected: "Deploy release",
		},
		{
			section: "Plugins" as const,
			primitive: "plugin" as const,
			query: "accessibility",
			expected: "agent-plugins-example",
		},
	])("searches installed $section metadata even when marketplace fails", async ({
		section,
		query,
		expected,
	}) => {
		fetchMarketplaceCatalog.mockRejectedValue(new Error("Catalog unavailable"));
		await act(async () =>
			root.render(
				<CustomizationSectionView
					section={section}
					searchQuery={query}
					searchResults
				/>,
			),
		);
		await vi.waitFor(() =>
			expect(container.textContent).toContain("Catalog unavailable"),
		);
		expect(container.textContent).toContain(expected);
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			1,
		);
		expect(
			container.querySelector(
				`[role="switch"][aria-label="Enable ${expected}"]`,
			),
		).not.toBeNull();
		expect(container.querySelector('input[type="text"]')).toBeNull();
	});
	it("shows neither results nor an empty state until the installed inventory arrives", async () => {
		let resolveInventory!: (response: typeof inventory) => void;
		const pendingInventory = new Promise((resolve) => {
			resolveInventory = resolve;
		});
		invoke.mockImplementation((command: string) =>
			command === "list_user_instruction_configs"
				? pendingInventory
				: Promise.resolve({ installedKeys: [] }),
		);
		await act(async () =>
			root.render(
				<CustomizationSectionView
					section="Skills"
					searchQuery="contributed"
					searchResults
				/>,
			),
		);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(container.textContent).toBe("");
		await act(async () => resolveInventory(inventory));
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			1,
		);
		expect(container.textContent).toContain("example-skill");
	});
	it("lists every tool for an empty query and leaves searching to the host page", async () => {
		await act(async () =>
			root.render(<CustomizationSectionView section="Tools" searchQuery="" />),
		);
		await vi.waitFor(() =>
			expect(container.textContent).toContain("Find content"),
		);
		expect(
			container.querySelector("input[type=text], [type=search]"),
		).toBeNull();
	});
});

describe("CustomizationSectionView Agent Plugin inventory", () => {
	function pluginDetails() {
		const details = container.querySelector<HTMLElement>(
			"[data-detail-content]",
		);
		if (!details) throw new Error("Expected the plugin details page");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		return details;
	}

	it("keeps plugin controls independent and opens a details page with a return to the card", async () => {
		let completeSave!: (response: unknown) => void;
		const save = new Promise((resolve) => {
			completeSave = resolve;
		});
		await act(async () =>
			root.render(<CustomizationSectionView section="Plugins" />),
		);
		const toggle = container.querySelector<HTMLInputElement>(
			'[role="switch"][aria-label="Enable agent-plugins-example"]',
		);
		const opener = container.querySelector<HTMLButtonElement>(
			'button[aria-label="View agent-plugins-example details"]',
		)!;
		const card = opener.closest('[data-slot="item-card"]')!;
		const cardText = card.textContent;
		expect(toggle?.checked).toBe(true);
		expect(opener.hasAttribute("aria-expanded")).toBe(false);
		expect(card.querySelector('[data-slot="item-card-content"]')).toBeNull();
		invoke.mockClear();
		invoke.mockReturnValueOnce(save);
		await act(async () => toggle?.click());
		expect(invoke).toHaveBeenCalledExactlyOnceWith("set_plugin_disabled", {
			path: AGENT_PLUGIN.path,
			disabled: true,
		});
		expect(toggle?.disabled).toBe(true);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		await act(async () => toggle?.click());
		expect(invoke).toHaveBeenCalledTimes(1);
		await act(async () =>
			completeSave({
				workspaceRoot: "/workspace",
				plugins: [{ ...AGENT_PLUGIN, enabled: false }],
			}),
		);
		expect(toggle?.checked).toBe(false);
		expect(toggle?.disabled).toBe(false);
		expect(card.textContent).toBe(cardText);
		await act(async () => {
			opener.focus();
			opener.click();
		});
		const details = pluginDetails();
		expect(details.textContent).toContain("example-skill");
		expect(details.textContent).toContain("Includes");
		expect(details.textContent).not.toContain("Capabilities");
		expect(details.textContent).not.toContain("Uninstall");
		expect(card.textContent).toBe(cardText);
		expect(card.querySelector('[data-slot="item-card-content"]')).toBeNull();
		expect(
			invoke.mock.calls.filter(
				([command]) => command === "set_plugin_disabled",
			),
		).toHaveLength(1);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[aria-label="Back to Manage"]')
				?.click(),
		);
		await vi.waitFor(() => {
			expect(
				container.querySelector('[aria-label="Back to Manage"]'),
			).toBeNull();
			expect(document.activeElement).toBe(opener);
		});
	});

	it("delegates plugin detail navigation to the host with its triggering card", async () => {
		const onOpenPlugin = vi.fn();
		await act(async () =>
			root.render(
				<CustomizationSectionView
					section="Plugins"
					onOpenPlugin={onOpenPlugin}
				/>,
			),
		);
		const opener = container.querySelector<HTMLButtonElement>(
			`[aria-label="View ${AGENT_PLUGIN.name} details"]`,
		);
		if (!opener) throw new Error("Expected plugin details button");
		await act(async () => opener.click());
		expect(onOpenPlugin).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				plugin: expect.objectContaining({ path: AGENT_PLUGIN.path }),
			}),
			opener,
		);
		expect(container.querySelector('[aria-label="Back to Manage"]')).toBeNull();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("copies the plugin path and handles uninstall retries from the details page", async () => {
		const plugin = {
			id: "project-tools",
			name: "project-tools",
			path: "/workspace/.cline/plugins/project-tools",
			enabled: true,
		};
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		let installed = true;
		let failUninstall!: (error: Error) => void;
		const pendingUninstall = new Promise((_, reject) => {
			failUninstall = reject;
		});
		const uninstallPlugin = vi
			.fn()
			.mockReturnValueOnce(pendingUninstall)
			.mockImplementationOnce(async () => {
				installed = false;
				return { message: "Uninstalled project-tools." };
			});
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs")
				return {
					workspaceRoot: "/workspace",
					plugins: installed ? [plugin] : [],
				};
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			if (command === "uninstall_local_primitive") return uninstallPlugin();
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(<CustomizationSectionView section="Plugins" />),
		);
		const opener = container.querySelector<HTMLButtonElement>(
			`[aria-label="View ${plugin.name} details"]`,
		);
		if (!opener) throw new Error("Expected plugin details button");
		const card = opener.closest('[data-slot="item-card"]');
		if (!card) throw new Error("Expected plugin card");
		const cardText = card.textContent;
		const toggle = card.querySelector<HTMLInputElement>('[role="switch"]');
		if (!toggle) throw new Error("Expected plugin toggle");
		expect(card.querySelector('[aria-label^="More actions for"]')).toBeNull();
		expect(toggle.checked).toBe(true);
		expect(cardText).not.toContain("Copy path");
		expect(cardText).not.toContain("Uninstall");
		await act(async () => opener.click());
		const details = pluginDetails();
		const action = (label: string, scope: ParentNode = details) => {
			const button = [...scope.querySelectorAll("button")].find(
				(button) =>
					button.getAttribute("aria-label") === label ||
					button.textContent?.trim() === label,
			);
			if (!button)
				throw new Error(`Expected ${label} action in plugin details`);
			return button;
		};
		const confirmUninstall = async () => {
			const dialog = document.querySelector('[role="alertdialog"]');
			if (!dialog) throw new Error("Expected uninstall confirmation");
			await act(async () => action("Uninstall", dialog).click());
		};
		await act(async () =>
			action("Plugin path actions").dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
		);
		const copy = [
			...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		].find((item) => item.textContent === "Copy path");
		expect(copy).toBeDefined();
		await act(async () => copy?.click());
		expect(writeText).toHaveBeenCalledExactlyOnceWith(plugin.path);
		invoke.mockClear();
		await act(async () => action("Uninstall").click());
		expect(invoke).not.toHaveBeenCalled();
		await confirmUninstall();
		expect(invoke).toHaveBeenCalledExactlyOnceWith(
			"uninstall_local_primitive",
			{
				type: "plugin",
				id: plugin.name,
				name: plugin.name,
				path: plugin.path,
			},
		);
		expect(action("Uninstalling…").disabled).toBe(true);
		expect(
			details.querySelector<HTMLInputElement>('[role="switch"]')?.disabled,
		).toBe(true);
		await act(async () => action("Uninstalling…").click());
		expect(uninstallPlugin).toHaveBeenCalledTimes(1);
		await act(async () => failUninstall(new Error("Could not remove plugin.")));
		expect(details.querySelector('[role="alert"]')?.textContent).toBe(
			"Could not remove plugin.",
		);
		expect(card.textContent).not.toContain("Could not remove plugin.");
		expect(action("Uninstall").disabled).toBe(false);
		expect(
			details.querySelector<HTMLInputElement>('[role="switch"]')?.disabled,
		).toBe(false);
		await act(async () => action("Uninstall").click());
		await confirmUninstall();
		expect(uninstallPlugin).toHaveBeenCalledTimes(2);
		expect(invoke).toHaveBeenCalledWith("list_user_instruction_configs");
		await vi.waitFor(() => {
			expect(
				container.querySelector('[aria-label="Back to Manage"]'),
			).toBeNull();
			expect(
				container.querySelector(`[aria-label="View ${plugin.name} details"]`),
			).toBeNull();
		});
	});

	it("shows plugin setup inline and handles failed actions in its details page", async () => {
		const plugin = {
			...AGENT_PLUGIN,
			description: "Read project documents.",
			loadError: "The plugin could not initialize.",
		};
		const entry = {
			id: plugin.name,
			type: "plugin",
			name: plugin.name,
			tagline: plugin.description,
			description: plugin.description,
			tags: [],
			author: { name: "Cline" },
			install: {
				command: "",
				args: [plugin.name],
				env: [{ name: "PLUGIN_KEY", description: "Project access key" }],
				notes: "Configure the project first.",
			},
		};
		fetchMarketplaceCatalog.mockResolvedValue({
			...EMPTY_CATALOG,
			entries: [entry],
		});
		let toggleAttempts = 0;
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs")
				return { workspaceRoot: "/workspace", plugins: [plugin] };
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [`plugin:${plugin.name}`] };
			if (command === "set_plugin_disabled") {
				if (++toggleAttempts === 1)
					throw new Error("Could not save plugin state.");
				return {
					workspaceRoot: "/workspace",
					plugins: [{ ...plugin, enabled: false, loadError: undefined }],
				};
			}
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(<CustomizationSectionView section="Plugins" />),
		);
		const opener = container.querySelector<HTMLButtonElement>(
			`[aria-label="View ${plugin.name} details"]`,
		)!;
		const card = opener.closest('[data-slot="item-card"]')!;
		const cardText = card.textContent;
		expect(cardText).toContain("By Cline");
		expect(
			card.querySelector('[data-slot="item-card-actions"] output')?.textContent,
		).toBe("Load error");
		expect(card.querySelector('[role="switch"]')).toBeNull();
		for (const detail of [
			"PLUGIN_KEY",
			plugin.loadError,
			"example-skill",
			entry.install.notes,
		])
			expect(cardText).not.toContain(detail);
		await act(async () => {
			opener.focus();
			opener.click();
		});
		const details = pluginDetails();
		for (const detail of [
			"PLUGIN_KEY",
			plugin.loadError,
			"example-skill",
			entry.install.notes,
		])
			expect(details.textContent).toContain(detail);
		const toggle = details.querySelector<HTMLInputElement>('[role="switch"]')!;
		expect(toggle.getAttribute("aria-label")).toBe(`Enable ${plugin.name}`);
		await act(async () => {
			toggle.focus();
			toggle.click();
		});
		expect(details.querySelector('[role="alert"]')?.textContent).toBe(
			"Could not save plugin state.",
		);
		expect(details.textContent).toContain(entry.install.notes);
		expect(card.textContent).not.toContain("Could not save plugin state.");
		expect(card.querySelector('[data-slot="item-card-content"]')).toBeNull();
		expect(card.querySelector('[role="switch"]')).toBeNull();
		await act(async () => toggle.click());
		expect(toggleAttempts).toBe(2);
		expect(details.querySelector('[role="alert"]')).toBeNull();
		expect(toggle.checked).toBe(false);
		expect(
			card.querySelector<HTMLInputElement>('[role="switch"]')?.checked,
		).toBe(false);
	});

	it("labels an invalid portable plugin separately from a load error", async () => {
		const plugin = {
			...AGENT_PLUGIN,
			toggleable: false,
			loadError: "The plugin manifest is invalid.",
		};
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs")
				return { workspaceRoot: "/workspace", plugins: [plugin] };
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(<CustomizationSectionView section="Plugins" />),
		);
		const opener = container.querySelector<HTMLButtonElement>(
			`[aria-label="View ${plugin.name} details"]`,
		);
		if (!opener) throw new Error("Expected plugin details button");
		const card = opener.closest('[data-slot="item-card"]');
		if (!card) throw new Error("Expected plugin card");
		expect(card.querySelector("output")?.textContent).toBe("Invalid plugin");
		expect(card.querySelector('[role="switch"]')).toBeNull();
		await act(async () => opener.click());
		const details = pluginDetails();
		expect(details.textContent).toContain(plugin.loadError);
		expect(
			details.querySelector<HTMLInputElement>('[role="switch"]')?.disabled,
		).toBe(true);
	});

	it("shows Hub-managed Agent Plugins in the installed Plugins view", async () => {
		await act(async () => {
			root.render(<CustomizationSectionView section="Plugins" />);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("agent-plugins-example");
		});
		expect(container.textContent).not.toContain("Agent Plugin");
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="View agent-plugins-example details"]',
				)
				?.click(),
		);
		expect(
			pluginDetails().querySelector('[title="Browse Plugins"]')?.textContent,
		).toBe("Plugin");
	});

	it("shows Agent Plugin skills in the installed Skills view", async () => {
		await act(async () => {
			root.render(<CustomizationSectionView section="Skills" />);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("example-skill");
			const toggle = container.querySelector<HTMLInputElement>(
				'[role="switch"][aria-label="Enable example-skill"]',
			);
			expect(toggle?.disabled).toBe(true);
			expect(toggle?.title).toBe("Managed by the installed plugin");
		});
	});
});

describe("installed skill detail navigation", () => {
	const localSkill = {
		name: "Local guide",
		description: "A project skill",
		instructions: "Follow the project guide.",
		path: "/workspace/.cline/skills/local-guide/SKILL.md",
	};
	const catalogSkill = {
		id: "local-guide",
		type: "skill" as const,
		name: "Catalog guide",
		tagline: "A concise catalog summary",
		description: "The catalog guide",
		author: { name: "Catalog author" },
		verified: true,
		tags: [],
		install: { command: "", args: ["local-guide"] },
	};
	const inventory = {
		workspaceRoot: "/workspace",
		rules: [],
		workflows: [
			{
				id: "deploy",
				name: "Deploy release",
				instructions: "Deploy the release.",
				path: "/workspace/.cline/workflows/deploy.md",
			},
		],
		skills: [localSkill, AGENT_PLUGIN_SKILL],
		agents: [],
		plugins: [AGENT_PLUGIN],
		tools: [],
		hooks: [],
		mcp: { servers: [] },
		warnings: [],
	};
	beforeEach(() => {
		fetchMarketplaceCatalog.mockResolvedValue({
			...EMPTY_CATALOG,
			entries: [catalogSkill],
		});
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs") return inventory;
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: ["skill:local-guide"] };
			if (command === "set_skill_disabled") return inventory;
			throw new Error(`Unexpected command: ${command}`);
		});
	});

	it.each([
		true,
		false,
	])("opens skill and workflow pages with catalog matches=%s", async (hasCatalogMatch) => {
		if (!hasCatalogMatch)
			fetchMarketplaceCatalog.mockResolvedValue(EMPTY_CATALOG);
		const onOpenSkill = vi.fn();
		const onOpenWorkflow = vi.fn();
		await act(async () =>
			root.render(
				<CustomizationSectionView
					section="Skills"
					onOpenSkill={onOpenSkill}
					onOpenWorkflow={onOpenWorkflow}
				/>,
			),
		);
		for (const skill of [localSkill, AGENT_PLUGIN_SKILL]) {
			const matchedCatalog = hasCatalogMatch && skill === localSkill;
			const displayName = matchedCatalog ? catalogSkill.name : skill.name;
			await vi.waitFor(() =>
				expect(
					container.querySelector(
						`button[aria-label="View ${displayName} details"]`,
					),
				).not.toBeNull(),
			);
			const detailsButton = container.querySelector<HTMLButtonElement>(
				`button[aria-label="View ${displayName} details"]`,
			);
			expect(detailsButton).not.toBeNull();
			const card = detailsButton?.closest('[data-slot="item-card"]');
			expect(card?.textContent).not.toContain(skill.path);
			expect(card?.querySelector('[aria-label^="More actions"]')).toBeNull();
			if (matchedCatalog) {
				expect(card?.textContent).toContain(catalogSkill.tagline);
				expect(card?.textContent).toContain("By Catalog author");
				expect(card?.querySelector('[aria-label="Verified"]')).not.toBeNull();
				expect(card?.textContent).not.toContain(localSkill.description);
				expect(card?.textContent).not.toContain(catalogSkill.description);
			}
			await act(async () => detailsButton?.click());
			expect(onOpenSkill).toHaveBeenLastCalledWith(
				expect.objectContaining({
					skill: expect.objectContaining(skill),
					...(hasCatalogMatch && skill === localSkill
						? { entry: catalogSkill }
						: {}),
				}),
				detailsButton,
			);
		}
		const workflowCard = [
			...container.querySelectorAll('[data-slot="item-card"]'),
		].find((card) => card.textContent?.includes("Deploy release"));
		if (!workflowCard) throw new Error("Expected workflow card");
		const workflowOpener = workflowCard.querySelector<HTMLButtonElement>(
			'[aria-label="View Deploy release details"]',
		)!;
		expect(workflowOpener).not.toBeNull();
		expect(
			workflowCard?.querySelector('[data-slot="item-card-content"]'),
		).toBeNull();
		expect(workflowCard?.textContent).not.toContain(
			inventory.workflows[0].path,
		);
		const workflowText = workflowCard?.textContent;
		onOpenSkill.mockClear();
		await act(async () => {
			workflowOpener.focus();
			workflowOpener.click();
		});
		expect(onOpenWorkflow).toHaveBeenCalledExactlyOnceWith(
			{
				workflow: expect.objectContaining(inventory.workflows[0]),
				entries: [],
			},
			workflowOpener,
		);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(workflowCard?.textContent).toBe(workflowText);
		expect(onOpenSkill).not.toHaveBeenCalled();
		if (hasCatalogMatch) {
			const toggle = container.querySelector<HTMLInputElement>(
				'[role="switch"][aria-label="Enable Catalog guide"]',
			);
			expect(toggle).not.toBeNull();
			await act(async () => toggle?.click());
			expect(invoke).toHaveBeenCalledWith("set_skill_disabled", {
				path: localSkill.path,
				disabled: true,
			});
			expect(onOpenSkill).not.toHaveBeenCalled();
		}
	});

	it.each([
		{ hasCatalogMatch: true, searchResults: false },
		{ hasCatalogMatch: true, searchResults: true },
		{ hasCatalogMatch: false, searchResults: false },
	])("opens disabled skill cards without enabling them (catalog matches=$hasCatalogMatch, search=$searchResults)", async ({
		hasCatalogMatch,
		searchResults,
	}) => {
		const onOpenSkill = vi.fn();
		if (!hasCatalogMatch)
			fetchMarketplaceCatalog.mockResolvedValue(EMPTY_CATALOG);
		const disabledSkills = [localSkill, AGENT_PLUGIN_SKILL].map((skill) => ({
			...skill,
			enabled: false,
		}));
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs")
				return { ...inventory, skills: disabledSkills };
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: ["skill:local-guide"] };
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(
				<CustomizationSectionView
					section="Skills"
					searchResults={searchResults}
					searchQuery={searchResults ? "skill" : undefined}
					onOpenSkill={onOpenSkill}
				/>,
			),
		);
		for (const skill of disabledSkills) {
			const name =
				hasCatalogMatch && skill.path === localSkill.path
					? catalogSkill.name
					: skill.name;
			await vi.waitFor(() =>
				expect(
					container.querySelector(`[aria-label="View ${name} details"]`),
				).not.toBeNull(),
			);
			const trigger = container.querySelector<HTMLButtonElement>(
				`[aria-label="View ${name} details"]`,
			);
			const toggle = container.querySelector<HTMLInputElement>(
				`[role="switch"][aria-label="Enable ${name}"]`,
			);
			expect(toggle?.checked).toBe(false);
			expect(trigger?.disabled).toBe(false);
			await act(async () => {
				trigger?.focus();
				trigger?.click();
			});
			expect(document.activeElement).toBe(trigger);
			expect(onOpenSkill).toHaveBeenLastCalledWith(
				expect.objectContaining({ skill: expect.objectContaining(skill) }),
				trigger,
			);
		}
		expect(
			invoke.mock.calls.some(([command]) => command === "set_skill_disabled"),
		).toBe(false);
	});

	it("forwards installed catalog-only skill selections to the detail page", async () => {
		const onOpenSkill = vi.fn();
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs")
				return { ...inventory, skills: [], workflows: [] };
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: ["skill:local-guide"] };
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(
				<CustomizationSectionView section="Skills" onOpenSkill={onOpenSkill} />,
			),
		);
		const detailsButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="View Catalog guide details"]',
		);
		expect(detailsButton).not.toBeNull();
		await act(async () => detailsButton?.click());
		expect(onOpenSkill).toHaveBeenCalledExactlyOnceWith(
			{ entry: catalogSkill },
			detailsButton,
		);
	});

	it("shares an in-flight skill toggle with details and displays its completed state", async () => {
		let finishToggle!: (value: unknown) => void;
		const pending = new Promise((resolve) => {
			finishToggle = resolve;
		});
		const original = invoke.getMockImplementation()!;
		invoke.mockImplementation((command: string, args: unknown) => {
			if (command === "set_skill_disabled") return pending;
			if (command === "get_installed_skill_preview")
				return Promise.resolve({ files: [], defaultPath: "" });
			return original(command, args);
		});
		await act(async () =>
			root.render(<CustomizationSectionView section="Skills" />),
		);
		await act(async () =>
			container
				.querySelector<HTMLInputElement>('[aria-label="Enable Catalog guide"]')
				?.click(),
		);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'[aria-label="View Catalog guide details"]',
				)
				?.click(),
		);
		const toggle = container.querySelector<HTMLInputElement>(
			'[aria-label="Enable Local guide"]',
		)!;
		expect(toggle.disabled).toBe(true);
		await act(async () => toggle.click());
		expect(
			invoke.mock.calls.filter(([command]) => command === "set_skill_disabled"),
		).toHaveLength(1);
		await act(async () =>
			finishToggle({
				...inventory,
				skills: [{ ...localSkill, enabled: false }, AGENT_PLUGIN_SKILL],
			}),
		);
		expect(toggle.checked).toBe(false);
		expect(toggle.disabled).toBe(false);
	});

	it("restores a failed skill card after a successful toggle in its details", async () => {
		let toggleAttempts = 0;
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs") return inventory;
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: ["skill:local-guide"] };
			if (command === "get_installed_skill_preview")
				return { files: [], defaultPath: "" };
			if (command === "set_skill_disabled") {
				if (++toggleAttempts === 1) throw new Error("Could not update skill.");
				return {
					...inventory,
					skills: [{ ...localSkill, enabled: false }, AGENT_PLUGIN_SKILL],
				};
			}
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(<CustomizationSectionView section="Skills" />),
		);
		await act(async () =>
			container
				.querySelector<HTMLInputElement>('[aria-label="Enable Catalog guide"]')
				?.click(),
		);
		expect(container.textContent).toContain("Could not update skill.");
		// An action failure is not a loading failure.
		expect(container.textContent).not.toContain(
			"Failed to load configuration lists",
		);
		expect(
			container
				.querySelector('[aria-label="View Catalog guide details"]')
				?.closest('[data-slot="item-card"]')
				?.querySelector("output")?.textContent,
		).toBe("Action failed");
		expect(
			container.querySelector('[aria-label="Enable Catalog guide"]'),
		).toBeNull();
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'[aria-label="View Catalog guide details"]',
				)
				?.click(),
		);
		const retry = container.querySelector<HTMLInputElement>(
			'[aria-label="Enable Local guide"]',
		);
		expect(retry).not.toBeNull();
		await act(async () => retry?.click());
		expect(toggleAttempts).toBe(2);
		expect(retry?.checked).toBe(false);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[aria-label="Back to Manage"]')
				?.click(),
		);
		await vi.waitFor(() => {
			const restored = container.querySelector<HTMLInputElement>(
				'[aria-label="Enable Catalog guide"]',
			);
			expect(restored?.checked).toBe(false);
			expect(restored?.disabled).toBe(false);
			expect(container.textContent).not.toContain("Could not update skill.");
			expect(
				restored?.closest('[data-slot="item-card"]')?.textContent,
			).not.toContain("Action failed");
		});
	});
});

describe("rule scope grouping", () => {
	it("reveals a rule's location from its details without leaving the page", async () => {
		const path = "/workspace/.cline/rules/style.md";
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs")
				return {
					workspaceRoot: "/workspace",
					rules: [
						{
							name: "Code conventions",
							path,
							instructions: "Use accessible components.",
						},
					],
				};
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(<CustomizationSectionView section="Rules" />),
		);
		const opener = container.querySelector<HTMLButtonElement>(
			'[aria-label="View details for Code conventions"]',
		);
		expect(opener).not.toBeNull();
		await act(async () => opener?.click());
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(container.textContent).toContain(path);
		await revealPathFromMenu(
			"Rule path",
			path,
			'nav[aria-label="Rule navigation"]',
		);
	});

	it.each([
		"/workspace",
		"/workspace/",
		"/home/user",
		"/",
		"C:\\Users\\test\\",
	])("classifies only exact workspace rule roots as Project for %s", async (workspaceRoot) => {
		const prefix = workspaceRoot.replaceAll("\\", "/").replace(/\/+$/, "");
		const ruleCases = [
			["workspace-agents", `${prefix}/AGENTS.md`, "Project"],
			["legacy-rule", `${prefix}/.clinerules/legacy-rule.md`, "Project"],
			["new-rule", `${prefix}/.cline/rules/new-rule.md`, "Project"],
			["nested-rule", `${prefix}/.cline/rules/team/nested.md`, "Project"],
			["single-file", `${prefix}/.clinerules`, "Project"],
			["nested-global", `${prefix}/other/.cline/rules/global.md`, "Global"],
			["nested-legacy", `${prefix}/other/.clinerules/global.md`, "Global"],
			["nested-agents", `${prefix}/other/AGENTS.md`, "Global"],
			["agents-prefix-sibling", `${prefix}/AGENTS.md-other`, "Global"],
			["agents-directory", `${prefix}/AGENTS.md/rule.md`, "Global"],
			["prefix-sibling", `${prefix}/.cline/rules-other/rule.md`, "Global"],
			["outside-rule", "/elsewhere/.cline/rules/global.md", "Global"],
			["outside-agents", "/elsewhere/AGENTS.md", "Global"],
		];
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			if (command === "list_user_instruction_configs") {
				return {
					workspaceRoot,
					rules: ruleCases.map(([name, path]) => ({
						name,
						path,
						instructions: name,
					})),
					workflows: [],
					skills: [],
					agents: [],
					plugins: [],
					tools: [],
					hooks: [],
					mcp: { servers: [] },
					warnings: [],
				};
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<CustomizationSectionView section="Rules" />);
		});

		await vi.waitFor(() => {
			for (const [name] of ruleCases)
				expect(container.textContent).toContain(name);
		});

		const scopeByRule = new Map<string, string>();
		for (const row of container.querySelectorAll<HTMLElement>(
			'[role="switch"][aria-label^="Enable "]',
		)) {
			const card = row.closest('[data-slot="item-card"]');
			const name = row.getAttribute("aria-label")?.replace(/^Enable /, "");
			const badge = card
				?.querySelector('[data-slot="badge"]')
				?.textContent?.trim();
			if (name) scopeByRule.set(name, badge ?? "");
		}
		for (const [name, , scope] of ruleCases)
			expect(scopeByRule.get(name)).toBe(scope);
	});
});

describe("tool details", () => {
	it.each([
		{ source: "builtin", searchResults: false, closeWithEscape: true },
		{ source: "plugin", searchResults: true, closeWithEscape: false },
	])("opens full $source tool details and returns focus when closed", async ({
		source,
		searchResults,
		closeWithEscape,
	}) => {
		const description = `${"Inspect every matching file in the workspace. ".repeat(12)}\n\nInclude all results, including this final paragraph.`;
		const tool = {
			id: "inspect-files",
			name: "Inspect files",
			description,
			source,
			enabled: source === "builtin",
			headlessToolNames: [
				"inspect_file",
				"inspect_directory",
				"inspect_results",
			],
			...(source === "plugin"
				? {
						pluginName: "Workspace inspection plugin",
						path: "/workspace/.cline/plugins/inspection/tools/inspect-files.ts",
					}
				: {}),
		};
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs")
				return {
					workspaceRoot: "/workspace",
					tools: [
						tool,
						{
							id: "inspect-another",
							name: "Inspect another",
							source,
							enabled: true,
						},
					],
				};
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(
				<CustomizationSectionView
					section="Tools"
					searchQuery={searchResults ? "inspect" : undefined}
					searchResults={searchResults}
				/>,
			),
		);
		const primaryButton = (name: string) =>
			container.querySelector<HTMLButtonElement>(
				`button[aria-label="View details for ${name}"]`,
			);
		await vi.waitFor(() => expect(primaryButton(tool.name)).not.toBeNull());
		const opener = primaryButton(tool.name)!;
		const card = opener.closest('[data-slot="item-card"]')!;
		const count = card.querySelector('[data-slot="item-card-count"]');
		expect(count?.textContent).toBe("3");
		expect(
			card.querySelector('[data-slot="item-card-footer"], [data-slot="badge"]'),
		).toBeNull();
		for (const name of tool.headlessToolNames)
			expect(card.textContent).not.toContain(name);
		expect(
			primaryButton("Inspect another")
				?.closest('[data-slot="item-card"]')
				?.querySelector('[data-slot="item-card-count"]'),
		).toBeNull();
		await act(async () => {
			opener.focus();
			opener.click();
		});
		const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
		if (!dialog) throw new Error("Expected tool details dialog");
		expect(
			dialog.querySelector('[data-slot="dialog-title"]')?.textContent,
		).toBe(tool.name);
		expect(
			[...dialog.querySelectorAll('[data-slot="dialog-body"] p')]
				.map((paragraph) => paragraph.textContent)
				.join(" ")
				.replace(/\s+/g, " ")
				.trim(),
		).toBe(description.replace(/\s+/g, " ").trim());
		expect(
			[...dialog.querySelectorAll("li")].map((item) => item.textContent),
		).toEqual(tool.headlessToolNames);
		const metadata = new Map(
			[...dialog.querySelectorAll("dt")].map((label) => [
				label.textContent,
				label.nextElementSibling?.textContent,
			]),
		);
		if (source === "plugin") {
			expect(metadata.get("Plugin")).toBe(tool.pluginName);
			expect(metadata.get("Path")).toBe(tool.path);
			if (!tool.path) throw new Error("Expected plugin tool path");
			await revealPathFromMenu("Tool path", tool.path);
		} else {
			expect(metadata.has("Plugin")).toBe(false);
			expect(metadata.has("Path")).toBe(false);
		}
		await act(async () => {
			if (closeWithEscape) {
				dialog.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				);
			} else {
				dialog
					.querySelector<HTMLButtonElement>('button[aria-label="Close"]')
					?.click();
			}
		});
		await vi.waitFor(() => {
			expect(document.querySelector('[role="dialog"]')).toBeNull();
			expect(document.activeElement).toBe(opener);
		});
		await act(async () => primaryButton("Inspect another")?.click());
		const nextDialog = document.querySelector('[role="dialog"]');
		expect(
			nextDialog?.querySelector('[data-slot="dialog-title"]')?.textContent,
		).toBe("Inspect another");
		expect(nextDialog?.textContent).toContain("No description available.");
		expect(nextDialog?.textContent).not.toContain(description);
		expect(invoke).not.toHaveBeenCalledWith(
			"set_tool_disabled",
			expect.anything(),
		);
	});
});

describe("tool state controls", () => {
	it.each([
		true,
		false,
	])("sets duplicate built-in names and synchronizes card and dialog toggles (enabled=%s)", async (initialEnabled) => {
		let enabled = initialEnabled;
		const inventory = () => ({
			workspaceRoot: "/workspace",
			tools: [
				{
					id: "web_search",
					name: "web_search",
					headlessToolNames: ["web_search"],
					source: "builtin",
					enabled,
				},
			],
		});
		let resolveInitialInventory!: (value: ReturnType<typeof inventory>) => void;
		const initialInventory = new Promise<ReturnType<typeof inventory>>(
			(resolve) => {
				resolveInitialInventory = resolve;
			},
		);
		let pendingSave: Promise<ReturnType<typeof inventory>> | undefined;
		invoke.mockImplementation(async (command, args) => {
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			if (command === "list_user_instruction_configs") return initialInventory;
			if (command === "set_tool_disabled") {
				if (pendingSave) return pendingSave;
				enabled = !args.disabled;
				return inventory();
			}
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () => {
			root.render(<CustomizationSectionView section="Tools" />);
		});
		// Initial inventory starts from a scheduled effect. A render-only act can
		// finish before that timer fires; never let an absent switch turn the click
		// into a silent no-op when the full suite is running concurrently.
		expect(
			container.querySelector('[aria-label="Enable web_search"]'),
		).toBeNull();
		await vi.waitFor(() =>
			expect(invoke).toHaveBeenCalledWith("list_user_instruction_configs"),
		);
		await act(async () => resolveInitialInventory(inventory()));
		const toggle = container.querySelector<HTMLInputElement>(
			'[aria-label="Enable web_search"]',
		);
		if (!toggle) throw new Error("Expected the loaded web_search toggle");
		expect(
			toggle
				.closest('[data-slot="item-card"]')
				?.querySelector('[data-slot="item-card-count"]'),
		).toBeNull();
		expect(toggle.checked).toBe(initialEnabled);
		await act(async () => toggle.click());
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(enabled).toBe(!initialEnabled);
		expect(invoke).toHaveBeenCalledWith("set_tool_disabled", {
			names: ["web_search", "web_search"],
			disabled: initialEnabled,
		});
		expect(
			container.querySelector<HTMLInputElement>(
				'[aria-label="Enable web_search"]',
			)?.checked,
		).toBe(!initialEnabled);

		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'[aria-label="View details for web_search"]',
				)
				?.click(),
		);
		const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
		const dialogToggle = dialog?.querySelector<HTMLInputElement>(
			'[data-slot="dialog-footer"] input[role="switch"]',
		);
		if (!dialog || !dialogToggle)
			throw new Error("Expected the tool dialog Enable switch");
		expect(dialogToggle.labels?.[0]?.textContent?.trim()).toBe("Enable");
		expect(dialogToggle.checked).toBe(!initialEnabled);
		let failSave!: (error: Error) => void;
		pendingSave = new Promise((_, reject) => {
			failSave = reject;
		});
		await act(async () => dialogToggle.click());
		expect(invoke).toHaveBeenCalledWith("set_tool_disabled", {
			names: ["web_search", "web_search"],
			disabled: !initialEnabled,
		});
		expect(toggle.disabled).toBe(true);
		expect(dialogToggle.disabled).toBe(true);
		await act(async () => failSave(new Error("Could not save tool settings.")));
		expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
			"Could not save tool settings.",
		);
		expect(
			container
				.querySelector('[aria-label="View details for web_search"]')
				?.closest('[data-slot="item-card"]')
				?.querySelector("output")?.textContent,
		).toBe("Action failed");
		expect(
			container.querySelector('[aria-label="Enable web_search"]'),
		).toBeNull();
		expect(dialogToggle.disabled).toBe(false);
		expect(dialogToggle.checked).toBe(!initialEnabled);

		let completeSave!: (response: ReturnType<typeof inventory>) => void;
		pendingSave = new Promise((resolve) => {
			completeSave = resolve;
		});
		await act(async () => dialogToggle.click());
		expect(dialog.querySelector('[role="alert"]')).toBeNull();
		const retryToggle = container.querySelector<HTMLInputElement>(
			'[aria-label="Enable web_search"]',
		)!;
		expect(retryToggle.disabled).toBe(true);
		expect(dialogToggle.disabled).toBe(true);
		await act(async () => {
			enabled = initialEnabled;
			completeSave(inventory());
		});
		expect(retryToggle.disabled).toBe(false);
		expect(dialogToggle.disabled).toBe(false);
		expect(retryToggle.checked).toBe(initialEnabled);
		expect(dialogToggle.checked).toBe(initialEnabled);
		expect(document.querySelector('[role="dialog"]')).toBe(dialog);
	});
});

describe("cached customization inventory", () => {
	const ruleInventory = {
		rules: [
			{
				name: "Cached rule",
				instructions: "Keep the current list visible.",
				path: "/workspace/.cline/rules/cached.md",
			},
		],
		tools: [],
	};

	it("shares a pending inventory read across mounted categories", async () => {
		let complete!: (value: typeof ruleInventory) => void;
		invoke.mockImplementation((command: string) =>
			command === "list_user_instruction_configs"
				? new Promise((resolve) => {
						complete = resolve;
					})
				: Promise.resolve([]),
		);
		await act(async () => {
			root.render(
				<>
					<CustomizationSectionView section="Rules" />
					<CustomizationSectionView section="Tools" />
				</>,
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(
			invoke.mock.calls.filter(
				([command]) => command === "list_user_instruction_configs",
			),
		).toHaveLength(1);
		await act(async () => complete(ruleInventory));
		expect(container.textContent).toContain("Cached rule");
	});

	it("renders cached content on remount and retains it during a stale refresh", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
		invoke.mockResolvedValueOnce(ruleInventory);
		const renderRules = async () => {
			await act(async () => {
				root.render(<CustomizationSectionView section="Rules" />);
			});
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
		};
		try {
			await renderRules();
			expect(container.textContent).toContain("Cached rule");
			await act(async () => root.render(null));
			await renderRules();
			expect(container.textContent).toContain("Cached rule");
			expect(invoke).toHaveBeenCalledOnce();
			await act(async () => root.render(null));
			now.mockReturnValue(62_000);
			let complete!: (value: typeof ruleInventory) => void;
			invoke.mockReturnValueOnce(
				new Promise((resolve) => {
					complete = resolve;
				}),
			);
			await renderRules();
			expect(invoke).toHaveBeenCalledTimes(2);
			expect(container.textContent).toContain("Cached rule");
			expect(
				container
					.querySelector('[aria-label="Refresh rules"]')
					?.getAttribute("disabled"),
			).toBeNull();
			await act(async () =>
				complete({
					...ruleInventory,
					rules: [{ ...ruleInventory.rules[0], name: "Updated rule" }],
				}),
			);
			expect(container.textContent).toContain("Updated rule");
			expect(container.textContent).not.toContain("Cached rule");
		} finally {
			now.mockRestore();
		}
	});
});
