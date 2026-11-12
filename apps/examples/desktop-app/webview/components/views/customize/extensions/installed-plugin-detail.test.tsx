// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	commitExtensionInventoryResponse,
	getCachedExtensionInventory,
	type PluginItem,
} from "@/lib/extension-inventory";
import type { MarketplaceEntry } from "@/lib/marketplace";
import type { MarketplaceDirectory } from "@/lib/use-marketplace-directory";
import {
	InstalledPluginDetailPage,
	type InstalledPluginSelection,
} from "./installed-plugin-detail";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	writeText: vi.fn(),
	updateCachedMarketplaceEntry: vi.fn(),
	install: vi.fn(),
	uninstall: vi.fn(),
	removeInstalledKeys: vi.fn(),
	directory: null as MarketplaceDirectory | null,
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: () => () => {} },
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/marketplace-installed", () => ({
	updateCachedMarketplaceEntry: mocks.updateCachedMarketplaceEntry,
}));
vi.mock("@/lib/use-marketplace-directory", () => ({
	useMarketplaceDirectory: () => mocks.directory,
}));

const plugin = {
	id: "local-browser",
	name: "agent-browser",
	path: "/workspace/.cline/plugins/agent-browser/index.ts",
	enabled: true,
	description: "Local browser instructions",
	contributions: {
		inspectionStatus: "available",
		capabilities: ["skills"],
		skills: ["browser-navigation"],
		tools: [],
		rules: [],
		hooks: [],
		commands: [],
		mcpServers: [],
		providers: [],
	},
} satisfies PluginItem;
const entry: MarketplaceEntry = {
	id: "agent-browser",
	type: "plugin",
	name: "Agent Browser",
	tagline: "Browse with your agent",
	description: "The complete marketplace description",
	tags: ["development"],
	author: { name: "Browser author", url: "https://example.com/author" },
	verified: true,
	homepage: "https://example.com/browser",
	install: {
		command: "cline",
		args: ["plugins", "add", "agent-browser"],
		env: [{ name: "BROWSER_TOKEN", required: true }],
		notes: "Install a supported browser first.",
	},
};
let container: HTMLDivElement;
let root: Root;
const onBack = vi.fn();

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
	vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
	for (const value of Object.values(mocks)) {
		if (vi.isMockFunction(value)) value.mockReset();
	}
	mocks.writeText.mockResolvedValue(undefined);
	mocks.install.mockResolvedValue(undefined);
	mocks.uninstall.mockResolvedValue(undefined);
	mocks.invoke.mockImplementation(async (command: string) => {
		if (command === "list_user_instruction_files")
			return { workspaceRoot: "/workspace", plugins: [] };
		return {};
	});
	mocks.directory = {
		catalog: null,
		errorMessage: null,
		loading: false,
		tagLabels: new Map([["development", "Software Development"]]),
		installedKeys: new Set(),
		installedReady: true,
		installedLoading: false,
		installedError: null,
		actionStates: new Map(),
		install: mocks.install,
		uninstall: mocks.uninstall,
		removeInstalledKeys: mocks.removeInstalledKeys,
	};
	onBack.mockReset();
	commitExtensionInventoryResponse({
		workspaceRoot: "/workspace",
		plugins: [plugin],
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

async function render(selection: InstalledPluginSelection = { plugin }) {
	await act(async () => {
		root.render(
			<InstalledPluginDetailPage selection={selection} onBack={onBack} />,
		);
	});
}
function findButton(label: string) {
	return [...container.querySelectorAll("button")].find(
		(candidate) =>
			candidate.getAttribute("aria-label") === label ||
			candidate.textContent === label,
	);
}
function button(label: string) {
	const match = findButton(label);
	expect(match, `Button ${label}`).toBeDefined();
	return match as HTMLButtonElement;
}
function dialogButton(label: string) {
	const dialog = document.querySelector('[role="alertdialog"]');
	expect(dialog).not.toBeNull();
	const match = [...(dialog?.querySelectorAll("button") ?? [])].find(
		(candidate) => candidate.textContent === label,
	);
	expect(match, `Dialog button ${label}`).toBeDefined();
	return match as HTMLButtonElement;
}
function toggle() {
	const result = container.querySelector<HTMLInputElement>('[role="switch"]');
	expect(result).not.toBeNull();
	return result as HTMLInputElement;
}
function directory() {
	if (!mocks.directory)
		throw new Error("Marketplace fixture is not initialized");
	return mocks.directory;
}

describe("Installed plugin detail page", () => {
	it("shows local plugin contents on the shared page without redundant capabilities", async () => {
		await render();
		expect(
			container.querySelector('nav[aria-label="Plugin navigation"]'),
		).not.toBeNull();
		expect(document.activeElement).toBe(button("Back to Manage"));
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		expect(container.textContent).toContain("Local browser instructions");
		expect(container.textContent).toContain("Includes");
		expect(container.textContent).toContain("Skills1browser-navigation");
		expect(container.textContent).not.toContain("Capabilities");
		expect(container.textContent).toContain("Project");
		expect(container.textContent).not.toContain("Verified");
		expect(container.textContent).not.toContain("Browser author");
		await act(async () =>
			button("Plugin path actions").dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
		);
		const copy = [
			...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		].find((item) => item.textContent === "Copy path");
		expect(copy).toBeDefined();
		await act(async () => copy?.click());
		expect(mocks.writeText).toHaveBeenCalledWith(plugin.path);
		expect(container.querySelector("output")?.textContent).toBe(
			"Plugin path copied.",
		);
		await act(async () => button("Back to Manage").click());
		expect(onBack).toHaveBeenCalledOnce();
	});

	it("retains catalog description, author, category, setup, and local metadata", async () => {
		await render({ plugin, entry });
		for (const value of [
			entry.name,
			entry.tagline,
			entry.description,
			"Browser author",
			"Verified",
			"Software Development",
			"BROWSER_TOKEN",
			"Install a supported browser first.",
			plugin.path,
			"browser-navigation",
		])
			expect(container.textContent).toContain(value);
		expect(
			container.textContent?.match(/The complete marketplace description/g),
		).toHaveLength(1);
		expect(button("Learn more")).toBeDefined();
		expect(toggle().checked).toBe(true);
	});

	it("preserves categories and setup guidance from every matched catalog entry", async () => {
		const alternate: MarketplaceEntry = {
			...entry,
			id: "browser-extras",
			name: "Browser Extras",
			tags: ["development", "productivity"],
			install: {
				command: "cline",
				args: ["plugins", "add", "browser-extras"],
				env: [{ name: "BROWSER_EXTRAS_TOKEN", required: false }],
				notes: "Enable the optional browser extras.",
			},
		};
		directory().tagLabels.set("productivity", "Productivity");
		await render({ plugin, entries: [entry, alternate, entry] });
		expect(container.textContent?.match(/Software Development/g)).toHaveLength(
			1,
		);
		expect(container.textContent).toContain("Productivity");
		expect(container.textContent).toContain("BROWSER_TOKEN");
		expect(container.textContent).toContain(
			"Install a supported browser first.",
		);
		const supplementalSetup = container.querySelector<HTMLElement>(
			'section[aria-label="Browser Extras setup"]',
		);
		expect(supplementalSetup).not.toBeNull();
		const trigger =
			supplementalSetup?.querySelector<HTMLButtonElement>("button");
		expect(trigger?.textContent).toBe("Marketplace setup instructions");
		await act(async () => trigger?.click());
		expect(supplementalSetup?.textContent).toContain("BROWSER_EXTRAS_TOKEN");
		expect(supplementalSetup?.textContent).toContain(
			"Enable the optional browser extras.",
		);
		expect(container.textContent?.match(/BROWSER_TOKEN/g)).toHaveLength(1);
		expect(
			container.textContent?.match(/Install a supported browser first\./g),
		).toHaveLength(1);
	});

	it("publishes toggle responses and keeps failures visible without changing the switch", async () => {
		await render();
		mocks.invoke.mockResolvedValueOnce({
			workspaceRoot: "/workspace",
			plugins: [{ ...plugin, enabled: false }],
		});
		await act(async () => toggle().click());
		expect(mocks.invoke).toHaveBeenCalledWith("set_plugin_disabled", {
			path: plugin.path,
			disabled: true,
		});
		expect(toggle().checked).toBe(false);
		expect(getCachedExtensionInventory()?.plugins[0]?.enabled).toBe(false);
		mocks.invoke.mockRejectedValueOnce(new Error("Could not enable plugin"));
		await act(async () => toggle().click());
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Could not enable plugin",
		);
		expect(toggle().checked).toBe(false);
	});

	it("requires confirmation and preserves the plugin when canceled or dismissed", async () => {
		await render();
		const uninstall = button("Uninstall");
		await act(async () => {
			uninstall.focus();
			uninstall.click();
		});
		expect(
			document.querySelector('[role="alertdialog"]')?.textContent,
		).toContain(`This will uninstall "${plugin.name}"`);
		expect(document.activeElement).toBe(dialogButton("Cancel"));
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"uninstall_local_primitive",
			expect.anything(),
		);
		await act(async () => dialogButton("Cancel").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(uninstall));
		await act(async () => uninstall.click());
		await act(async () => {
			dialogButton("Cancel").dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"uninstall_local_primitive",
			expect.anything(),
		);
		expect(mocks.uninstall).not.toHaveBeenCalled();
		expect(onBack).not.toHaveBeenCalled();
	});

	it("keeps uninstall errors visible and clears every matched catalog entry on success", async () => {
		const alternate = { ...entry, id: "alternate-browser" };
		await render({ plugin, entries: [entry, alternate] });
		mocks.invoke.mockRejectedValueOnce(new Error("Could not uninstall plugin"));
		await act(async () => button("Uninstall").click());
		await act(async () => dialogButton("Uninstall").click());
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Could not uninstall plugin",
		);
		expect(onBack).not.toHaveBeenCalled();
		expect(mocks.updateCachedMarketplaceEntry).not.toHaveBeenCalled();
		let finishUninstall: () => void = () => {};
		mocks.invoke.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishUninstall = resolve;
				}),
		);
		await act(async () => button("Uninstall").click());
		await act(async () => dialogButton("Uninstall").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(button("Uninstalling…").disabled).toBe(true);
		expect(toggle().disabled).toBe(true);
		await act(async () => button("Uninstalling…").click());
		expect(
			mocks.invoke.mock.calls.filter(
				([command]) => command === "uninstall_local_primitive",
			),
		).toHaveLength(2);
		await act(async () => finishUninstall());
		expect(mocks.invoke).toHaveBeenCalledWith("uninstall_local_primitive", {
			type: "plugin",
			id: plugin.name,
			name: plugin.name,
			path: plugin.path,
		});
		expect(mocks.updateCachedMarketplaceEntry).toHaveBeenCalledWith(
			entry,
			false,
		);
		expect(mocks.updateCachedMarketplaceEntry).toHaveBeenCalledWith(
			alternate,
			false,
		);
		expect(mocks.removeInstalledKeys).toHaveBeenCalledWith([
			"plugin:agent-browser",
			"plugin:alternate-browser",
		]);
		expect(onBack).toHaveBeenCalledExactlyOnceWith({ uninstalled: true });
	});

	it("preserves agent plugin restrictions and reports load errors", async () => {
		const agentPlugin = {
			...plugin,
			agentPlugin: true,
			toggleable: false,
			loadError: "Invalid plugin configuration",
		};
		commitExtensionInventoryResponse({ plugins: [agentPlugin] });
		await render({ plugin: agentPlugin });
		expect(toggle().disabled).toBe(true);
		expect(findButton("Uninstall")).toBeUndefined();
		expect(findButton("Plugin path actions")).toBeUndefined();
		expect(container.textContent).not.toContain(plugin.path);
		expect(button("Plugin")).toBeDefined();
		expect(container.textContent).toContain("Invalid plugin configuration");
	});

	it("shows disabled inspection guidance and falls back to registered tools", async () => {
		const disabledPlugin = {
			...plugin,
			enabled: false,
			contributions: undefined,
		};
		commitExtensionInventoryResponse({
			plugins: [disabledPlugin],
			tools: [
				{
					id: "navigate",
					name: "navigate",
					source: "plugin",
					path: plugin.path,
					enabled: true,
				},
			],
		});
		await render({ plugin: disabledPlugin });
		expect(container.textContent).toContain("Tools1navigate");
		expect(toggle().checked).toBe(false);
		await act(async () => {
			commitExtensionInventoryResponse({
				plugins: [
					{
						...plugin,
						contributions: {
							...plugin.contributions,
							inspectionStatus: "disabled",
						},
					},
				],
			});
		});
		expect(container.textContent).toContain(
			"Enable this plugin to inspect its dynamic contributions.",
		);
	});

	it.each([
		"failed",
		undefined,
	] as const)("explains unavailable plugin contents when inspection status is %s", async (inspectionStatus) => {
		const uninspectedPlugin: PluginItem = {
			...plugin,
			contributions: inspectionStatus
				? { ...plugin.contributions, skills: [], inspectionStatus }
				: undefined,
		};
		commitExtensionInventoryResponse({ plugins: [uninspectedPlugin] });
		await render({ plugin: uninspectedPlugin });
		expect(
			container.querySelector('section[aria-label="Plugin contents"]')
				?.textContent,
		).toContain("Plugin contents are unavailable.");
		expect(container.textContent).not.toContain(
			"No plugin contributions found.",
		);
	});

	it("resolves an installed Browse entry to the matching local plugin", async () => {
		directory().installedKeys.add("plugin:agent-browser");
		await render({ entry });
		expect(toggle().checked).toBe(true);
		expect(container.textContent).toContain(plugin.path);
		expect(container.textContent).toContain(entry.description);
	});

	it("does not guess between ambiguous local plugins", async () => {
		commitExtensionInventoryResponse({
			plugins: [plugin, { ...plugin, path: "/global/agent-browser/index.ts" }],
		});
		directory().installedKeys.add("plugin:agent-browser");
		await render({ entry });
		expect(container.querySelector('[role="switch"]')).toBeNull();
		await act(async () => button("Uninstall").click());
		expect(mocks.uninstall).not.toHaveBeenCalled();
		await act(async () => dialogButton("Uninstall").click());
		expect(mocks.uninstall).toHaveBeenCalledWith(entry);
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"uninstall_local_primitive",
			expect.anything(),
		);
	});

	it("waits for catalog readiness and supports catalog-only install and uninstall", async () => {
		commitExtensionInventoryResponse({ plugins: [] });
		directory().installedReady = false;
		await render({ entry });
		expect(button("Checking…").disabled).toBe(true);
		expect(container.querySelector('[role="switch"]')).toBeNull();
		directory().installedReady = true;
		await render({ entry });
		await act(async () => button("Install").click());
		expect(mocks.install).toHaveBeenCalledWith(entry);
		directory().installedKeys.add("plugin:agent-browser");
		await render({ entry });
		await act(async () => button("Uninstall").click());
		expect(mocks.uninstall).not.toHaveBeenCalled();
		await act(async () => dialogButton("Cancel").click());
		expect(mocks.uninstall).not.toHaveBeenCalled();
		await act(async () => button("Uninstall").click());
		await act(async () => dialogButton("Uninstall").click());
		expect(mocks.uninstall).toHaveBeenCalledWith(entry);
		directory().actionStates.set("plugin:agent-browser", {
			status: "uninstalled",
			message: "Removed",
		});
		await render({ entry });
		expect(onBack).toHaveBeenCalledExactlyOnceWith({ uninstalled: true });
	});

	it("keeps catalog actions disabled when installed status cannot be checked", async () => {
		commitExtensionInventoryResponse({ plugins: [] });
		directory().installedError = "Installed status unavailable";
		await render({ entry });
		expect(button("Install").disabled).toBe(true);
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Installed status unavailable",
		);
	});
});
