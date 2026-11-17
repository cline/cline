// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetComposioCacheForTesting } from "@/lib/composio";
import {
	invalidateExtensionInventoryCache,
	type PluginItem,
} from "@/lib/extension-inventory";
import type { MarketplaceEntry } from "@/lib/marketplace";
import { clearMarketplaceInstalledEntries } from "@/lib/marketplace-installed";
import type { CustomizeSection } from "./customize-sections";
import {
	CustomizeTestHarness,
	createCustomizeTestRoot,
	findButton,
	setInputValue,
} from "./customize-test-utils";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	catalog: vi.fn(),
	plugins: [] as PluginItem[],
	installedKeys: [] as string[],
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: () => () => {} },
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/marketplace", () => ({
	fetchMarketplaceCatalog: mocks.catalog,
	getCachedMarketplaceCatalog: () => null,
	subscribeMarketplaceCatalog: () => () => {},
}));

const plugin: PluginItem = {
	id: "agent-browser",
	name: "agent-browser",
	path: "/workspace/.cline/plugins/agent-browser",
	description: "Browse and inspect websites.",
	enabled: true,
	source: "workspace-plugin",
	contributions: {
		capabilities: ["skills"],
		skills: ["agent-browser"],
		tools: [],
		rules: [],
		hooks: [],
		commands: [],
		mcpServers: [],
		providers: [],
	},
};
const entry: MarketplaceEntry = {
	id: "agent-browser",
	type: "plugin",
	name: "agent-browser",
	tagline: "Browse and inspect websites.",
	description: "Give Cline a browser workflow.",
	tags: ["software-development"],
	author: { name: "Browser tools" },
	install: { command: "cline", args: ["plugins", "add", "agent-browser"] },
};

let container: HTMLDivElement;
let root: Root;
let cleanup: () => Promise<void>;

beforeEach(() => {
	resetComposioCacheForTesting();
	invalidateExtensionInventoryCache();
	clearMarketplaceInstalledEntries();
	mocks.plugins = [plugin];
	mocks.installedKeys = ["plugin:agent-browser"];
	mocks.catalog.mockReset().mockResolvedValue({
		version: 1,
		counts: { total: 1, plugins: 1, skills: 0, mcps: 0 },
		tags: [{ id: "software-development", label: "Software Development" }],
		entries: [entry],
	});
	mocks.invoke.mockReset().mockImplementation(async (command: string) => {
		if (command === "composio_integrations")
			return { configured: false, integrations: [] };
		if (command === "list_marketplace_installed_entries")
			return { installedKeys: mocks.installedKeys };
		if (command === "list_mcp_servers")
			return { settingsPath: "", hasSettingsFile: false, servers: [] };
		if (command === "list_user_instruction_configs")
			return { workspaceRoot: "/workspace", plugins: mocks.plugins };
		throw new Error(`Unexpected desktop command: ${command}`);
	});
	({ container, root, cleanup } = createCustomizeTestRoot());
});

afterEach(() => cleanup());

function button(label: string, within: ParentNode = container) {
	return findButton(within, label);
}

function visiblePluginPage() {
	const navigation = container.querySelector(
		'nav[aria-label="Plugin navigation"]',
	);
	expect(navigation).not.toBeNull();
	expect(navigation?.closest("[hidden]")).toBeNull();
	expect(document.querySelector('[role="dialog"]')).toBeNull();
}

async function render(section: CustomizeSection) {
	await act(async () => {
		root.render(
			<CustomizeTestHarness
				initialCategory="plugins"
				initialSection={section}
			/>,
		);
	});
}

describe("Plugin detail navigation", () => {
	it.each([
		["browse", "Browse"],
		["manage", "Manage"],
	] as const)("opens installed plugins from %s in a full page and restores the list position and focus", async (section, label) => {
		await render(section);
		const trigger = button("View agent-browser details");
		const viewport = trigger.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!viewport) throw new Error("Missing list scroll viewport");
		viewport.scrollTop = 384;
		trigger.focus();
		await act(async () => trigger.click());
		visiblePluginPage();
		expect(button("Plugin path actions").closest("[hidden]")).toBeNull();
		const enabled = [
			...container.querySelectorAll<HTMLInputElement>(
				'[role="switch"][aria-label="Enable agent-browser"]',
			),
		].find((toggle) => !toggle.closest("[hidden]"));
		expect(enabled?.checked).toBe(true);
		const back = button(`Back to ${label}`);
		expect(document.activeElement).toBe(back);
		expect(trigger.closest("[hidden]")).not.toBeNull();
		viewport.scrollTop = 0;
		await act(async () => back.click());
		expect(
			container.querySelector('nav[aria-label="Plugin navigation"]'),
		).toBeNull();
		expect(trigger.closest("[hidden]")).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(viewport.scrollTop).toBe(384);
		expect(
			container
				.querySelector(
					`[aria-label="${label} categories"] [data-customize-category="plugins"]`,
				)
				?.getAttribute("aria-checked"),
		).toBe("true");
	});

	it("opens an uninstalled Browse plugin in the same full-page layout", async () => {
		mocks.plugins = [];
		mocks.installedKeys = [];
		await render("browse");
		await act(async () => button("View agent-browser details").click());
		visiblePluginPage();
		expect(button("Install").disabled).toBe(false);
		expect(button("Back to Browse")).toBeDefined();
	});

	it("opens catalog-only installed plugins from Manage without requiring local inventory", async () => {
		mocks.plugins = [];
		await render("manage");
		await act(async () => button("View agent-browser details").click());
		visiblePluginPage();
		expect(button("Uninstall").disabled).toBe(false);
		expect(button("Back to Manage")).toBeDefined();
	});

	it("returns to the catalog card and scroll position after an inline uninstall failure", async () => {
		mocks.plugins = [];
		await render("manage");
		const trigger = button("View agent-browser details");
		const card = trigger.closest('[data-slot="item-card"]');
		const viewport = trigger.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!card || !viewport) throw new Error("Missing installed plugin card");
		viewport.scrollTop = 512;
		mocks.invoke.mockRejectedValueOnce(new Error("Plugin files are busy"));
		await act(async () => button("Uninstall", card).click());
		const confirmation = document.querySelector('[role="alertdialog"]');
		if (!confirmation) throw new Error("Missing uninstall confirmation");
		await act(async () => button("Uninstall", confirmation).click());
		visiblePluginPage();
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Plugin files are busy",
		);
		expect(card.textContent).toContain("Uninstall failed");
		expect(mocks.invoke).toHaveBeenCalledWith(
			"uninstall_marketplace_entry",
			{ entry },
			{ timeoutMs: 300_000 },
		);
		viewport.scrollTop = 0;
		await act(async () => button("Back to Manage").click());
		expect(document.activeElement).toBe(trigger);
		expect(viewport.scrollTop).toBe(512);
		expect(trigger.closest("[hidden]")).toBeNull();
	});

	it("clears a failed card toggle after retrying successfully in the detail page", async () => {
		await render("manage");
		const trigger = button("View agent-browser details");
		const card = trigger.closest('[data-slot="item-card"]');
		const toggle = card?.querySelector<HTMLInputElement>('[role="switch"]');
		if (!card || !toggle) throw new Error("Missing installed plugin toggle");
		mocks.invoke.mockRejectedValueOnce(new Error("Could not disable plugin"));
		await act(async () => toggle.click());
		visiblePluginPage();
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Could not disable plugin",
		);
		expect(card.textContent).toContain("Action failed");
		const retry = [
			...container.querySelectorAll<HTMLInputElement>(
				'[role="switch"][aria-label="Enable agent-browser"]',
			),
		].find((candidate) => !candidate.closest("[hidden]"));
		if (!retry) throw new Error("Missing detail page toggle");
		mocks.plugins = [{ ...plugin, enabled: false }];
		mocks.invoke.mockResolvedValueOnce({
			workspaceRoot: "/workspace",
			plugins: mocks.plugins,
		});
		await act(async () => retry.click());
		expect(container.querySelector('[role="alert"]')).toBeNull();
		await act(async () => button("Back to Manage").click());
		expect(document.activeElement).toBe(trigger);
		expect(card.textContent).not.toContain("Action failed");
		expect(
			card.querySelector<HTMLInputElement>('[role="switch"]')?.checked,
		).toBe(false);
	});

	it("returns from an installed search result with its query and card focus preserved", async () => {
		await render("manage");
		const search = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search customizations"]',
		);
		if (!search) throw new Error("Missing Customize search");
		await setInputValue(search, "agent-browser");
		const results = container.querySelector(
			'[aria-label="Installed search results"]',
		);
		if (!results) throw new Error("Missing installed search results");
		const trigger = button("View agent-browser details", results);
		await act(async () => trigger.click());
		visiblePluginPage();
		await act(async () => button("Back to Search results").click());
		expect(search.value).toBe("agent-browser");
		expect(results.closest("[hidden]")).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(button("Clear customization search")).toBeDefined();
	});
});

it("keeps the current detail when an earlier plugin card action fails", async () => {
	const otherPlugin = {
		...plugin,
		id: "other-plugin",
		name: "Other plugin",
		path: "/workspace/.cline/plugins/other-plugin",
	};
	mocks.plugins = [plugin, otherPlugin];
	let failToggle!: (error: Error) => void;
	const pending = new Promise((_, reject) => {
		failToggle = reject;
	});
	const original = mocks.invoke.getMockImplementation()!;
	mocks.invoke.mockImplementation((command: string, args: unknown) =>
		command === "set_plugin_disabled" ? pending : original(command, args),
	);
	await render("manage");
	const toggle = container.querySelector<HTMLInputElement>(
		'[role="switch"][aria-label="Enable agent-browser"]',
	)!;
	await act(async () => toggle.click());
	await act(async () => button("View Other plugin details").click());
	await act(async () => failToggle(new Error("First plugin toggle failed")));
	const visibleHeadings = [...container.querySelectorAll("h1,h2")]
		.filter((node) => !node.closest("[hidden]"))
		.map((node) => node.textContent);
	expect(visibleHeadings).toContain("Other plugin");
	expect(visibleHeadings).not.toContain("agent-browser");
	await act(async () => button("Back to Manage").click());
	expect(
		button("View agent-browser details").closest('[data-slot="item-card"]')
			?.textContent,
	).toContain("Action failed");
	await act(async () => button("View agent-browser details").click());
	expect(container.querySelector('[role="alert"]')?.textContent).toBe(
		"First plugin toggle failed",
	);
});

it("shares a plugin's pending card action with its detail page", async () => {
	let finishToggle!: (value: unknown) => void;
	const pending = new Promise((resolve) => {
		finishToggle = resolve;
	});
	const original = mocks.invoke.getMockImplementation()!;
	mocks.invoke.mockImplementation((command: string, args: unknown) =>
		command === "set_plugin_disabled" ? pending : original(command, args),
	);
	await render("manage");
	const cardToggle = container.querySelector<HTMLInputElement>(
		'[role="switch"][aria-label="Enable agent-browser"]',
	)!;
	await act(async () => cardToggle.click());
	await act(async () => button("View agent-browser details").click());
	const detailToggle = [
		...container.querySelectorAll<HTMLInputElement>(
			'[role="switch"][aria-label="Enable agent-browser"]',
		),
	].find((node) => !node.closest("[hidden]"))!;
	expect(detailToggle.disabled).toBe(true);
	expect(button("Uninstall").disabled).toBe(true);
	await act(async () => detailToggle.click());
	expect(
		mocks.invoke.mock.calls.filter(
			([command]) => command === "set_plugin_disabled",
		),
	).toHaveLength(1);
	mocks.plugins = [{ ...plugin, enabled: false }];
	await act(async () =>
		finishToggle({ workspaceRoot: "/workspace", plugins: mocks.plugins }),
	);
	expect(detailToggle.checked).toBe(false);
	expect(detailToggle.disabled).toBe(false);
});
