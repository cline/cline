// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CustomizationSectionView,
	invalidateExtensionInventoryCache,
} from "./extensions-view";

const { connectorChanges, fetchMarketplaceCatalog, invoke, subscribers } =
	vi.hoisted(() => ({
		connectorChanges: new Set<() => void>(),
		fetchMarketplaceCatalog: vi.fn(),
		invoke: vi.fn(),
		subscribers: new Map<string, () => void>(),
	}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke,
		subscribe: (eventName: string, callback: () => void) => {
			subscribers.set(eventName, callback);
			return () => {
				if (subscribers.get(eventName) === callback) {
					subscribers.delete(eventName);
				}
			};
		},
	},
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/composio", () => ({
	subscribeComposioInventoryChanges: (callback: () => void) => {
		connectorChanges.add(callback);
		return () => connectorChanges.delete(callback);
	},
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
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
				tools: [
					{
						id: "read_file",
						name: "read_file",
						source: "builtin",
						enabled: true,
					},
				],
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
});

describe("CustomizationSectionView Agent Plugin inventory", () => {
	it("toggles a plugin without expanding its row and disables the switch while saving", async () => {
		let completeSave!: (response: unknown) => void;
		const save = new Promise((resolve) => {
			completeSave = resolve;
		});
		await act(async () => {
			root.render(
				<CustomizationSectionView
					catalogPrimitive="plugin"
					chrome="embedded"
					marketplaceVariant="installed"
					section="Plugins"
				/>,
			);
		});
		const toggle = container.querySelector<HTMLInputElement>(
			'[role="switch"][aria-label="Toggle agent-plugins-example"]',
		);
		const details = toggle?.closest("details");
		expect(toggle?.checked).toBe(true);
		expect(details?.open).toBe(false);
		invoke.mockClear();
		invoke.mockReturnValueOnce(save);

		await act(async () => toggle?.click());
		expect(invoke).toHaveBeenCalledExactlyOnceWith("set_plugin_disabled", {
			path: AGENT_PLUGIN.path,
			disabled: true,
		});
		expect(toggle?.disabled).toBe(true);
		expect(details?.open).toBe(false);
		await act(async () => toggle?.click());
		expect(invoke).toHaveBeenCalledTimes(1);

		await act(async () => {
			completeSave({
				workspaceRoot: "/workspace",
				plugins: [{ ...AGENT_PLUGIN, enabled: false }],
			});
		});
		expect(toggle?.checked).toBe(false);
		expect(toggle?.disabled).toBe(false);
		expect(details?.open).toBe(false);
	});

	it("serializes full-inventory mutations so older replies cannot undo newer toggles", async () => {
		const secondPlugin = {
			...AGENT_PLUGIN,
			id: "agent-plugin:/Users/test/.agents/plugins/second",
			name: "agent-plugins-second",
			path: "/Users/test/.agents/plugins/second",
		};
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			if (command === "list_user_instruction_configs") {
				return {
					workspaceRoot: "/workspace",
					plugins: [AGENT_PLUGIN, secondPlugin],
				};
			}
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () => {
			root.render(
				<CustomizationSectionView
					catalogPrimitive="plugin"
					chrome="embedded"
					marketplaceVariant="installed"
					section="Plugins"
				/>,
			);
		});
		const firstToggle = container.querySelector<HTMLInputElement>(
			'[role="switch"][aria-label="Toggle agent-plugins-example"]',
		);
		const secondToggle = container.querySelector<HTMLInputElement>(
			'[role="switch"][aria-label="Toggle agent-plugins-second"]',
		);
		let resolveFirst!: (response: unknown) => void;
		let resolveSecond!: (response: unknown) => void;
		const first = new Promise((resolve) => {
			resolveFirst = resolve;
		});
		const second = new Promise((resolve) => {
			resolveSecond = resolve;
		});
		invoke.mockReset();
		invoke.mockReturnValueOnce(first).mockReturnValueOnce(second);

		await act(async () => {
			firstToggle?.click();
			secondToggle?.click();
			await Promise.resolve();
		});
		expect(invoke).toHaveBeenCalledExactlyOnceWith("set_plugin_disabled", {
			path: AGENT_PLUGIN.path,
			disabled: true,
		});
		await act(async () =>
			resolveFirst({
				workspaceRoot: "/workspace",
				plugins: [
					{ ...AGENT_PLUGIN, enabled: false },
					{ ...secondPlugin, enabled: true },
				],
			}),
		);
		expect(invoke).toHaveBeenCalledTimes(2);
		expect(invoke).toHaveBeenLastCalledWith("set_plugin_disabled", {
			path: secondPlugin.path,
			disabled: true,
		});
		await act(async () =>
			resolveSecond({
				workspaceRoot: "/workspace",
				plugins: [
					{ ...AGENT_PLUGIN, enabled: false },
					{ ...secondPlugin, enabled: false },
				],
			}),
		);
		expect(firstToggle?.checked).toBe(false);
		expect(secondToggle?.checked).toBe(false);
	});

	it("shows Hub-managed Agent Plugins in the installed Plugins view", async () => {
		await act(async () => {
			root.render(
				<CustomizationSectionView
					catalogPrimitive="plugin"
					chrome="embedded"
					marketplaceVariant="installed"
					section="Plugins"
				/>,
			);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("agent-plugins-example");
			expect(container.textContent).toContain("Agent Plugin");
		});
	});

	it("shows Agent Plugin skills in the installed Skills view", async () => {
		await act(async () => {
			root.render(
				<CustomizationSectionView
					catalogPrimitive="skill"
					chrome="embedded"
					marketplaceVariant="installed"
					section="Skills"
				/>,
			);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("example-skill");
			expect(container.textContent).toContain("Agent Plugin");
		});
	});

	it("invalidates cached inventory after connector and account changes while unmounted", async () => {
		const renderPlugins = async () => {
			await act(async () => {
				root.render(
					<CustomizationSectionView
						catalogPrimitive="plugin"
						chrome="embedded"
						marketplaceVariant="installed"
						section="Plugins"
					/>,
				);
			});
		};
		const inventoryReads = () =>
			invoke.mock.calls.filter(
				([command]) => command === "list_user_instruction_configs",
			).length;

		await renderPlugins();
		await vi.waitFor(() => expect(inventoryReads()).toBe(1));
		expect(subscribers.has("settings.changed")).toBe(true);
		expect(subscribers.has("cloud_sessions_changed")).toBe(true);
		expect(connectorChanges.size).toBe(1);

		await act(async () => root.unmount());
		act(() => {
			for (const callback of connectorChanges) callback();
		});
		root = createRoot(container);
		await renderPlugins();
		await vi.waitFor(() => expect(inventoryReads()).toBe(2));

		await act(async () => root.unmount());
		act(() => subscribers.get("cloud_sessions_changed")?.());
		root = createRoot(container);
		await renderPlugins();
		await vi.waitFor(() => expect(inventoryReads()).toBe(3));
	});
});

describe("rule scope grouping", () => {
	it.each([
		"/workspace",
		"/workspace/",
		"/home/user",
		"/",
		"C:\\Users\\test\\",
	])("classifies only exact workspace rule roots as Project for %s", async (workspaceRoot) => {
		const prefix = workspaceRoot.replaceAll("\\", "/").replace(/\/+$/, "");
		const ruleCases = [
			["legacy-rule", `${prefix}/.clinerules/legacy-rule.md`, "Project"],
			["new-rule", `${prefix}/.cline/rules/new-rule.md`, "Project"],
			["nested-rule", `${prefix}/.cline/rules/team/nested.md`, "Project"],
			["single-file", `${prefix}/.clinerules`, "Project"],
			["nested-global", `${prefix}/other/.cline/rules/global.md`, "Global"],
			["nested-legacy", `${prefix}/other/.clinerules/global.md`, "Global"],
			["prefix-sibling", `${prefix}/.cline/rules-other/rule.md`, "Global"],
			["outside-rule", "/elsewhere/.cline/rules/global.md", "Global"],
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
			'[role="switch"][aria-label^="Toggle "]',
		)) {
			const card = row.closest("div.grid");
			const name = row.getAttribute("aria-label")?.replace(/^Toggle /, "");
			const badge = card
				?.querySelector('[data-slot="badge"]')
				?.textContent?.trim();
			if (name) scopeByRule.set(name, badge ?? "");
		}
		for (const [name, , scope] of ruleCases)
			expect(scopeByRule.get(name)).toBe(scope);
	});
});

describe("tool state controls", () => {
	it.each([
		true,
		false,
	])("sets duplicate built-in names explicitly (enabled=%s)", async (initialEnabled) => {
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
		invoke.mockImplementation(async (command, args) => {
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			if (command === "list_user_instruction_configs") return inventory();
			if (command === "set_tool_disabled") {
				enabled = !args.disabled;
				return inventory();
			}
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () => {
			root.render(<CustomizationSectionView section="Tools" />);
		});
		const toggle = await vi.waitFor(() => {
			const element = container.querySelector<HTMLInputElement>(
				'[aria-label="Toggle web_search"]',
			);
			expect(element).not.toBeNull();
			return element;
		});
		await act(async () => toggle?.click());
		expect(enabled).toBe(!initialEnabled);
		expect(invoke).toHaveBeenCalledWith("set_tool_disabled", {
			names: ["web_search", "web_search"],
			disabled: initialEnabled,
		});
		expect(
			container.querySelector<HTMLInputElement>(
				'[aria-label="Toggle web_search"]',
			)?.checked,
		).toBe(!initialEnabled);
	});
});
