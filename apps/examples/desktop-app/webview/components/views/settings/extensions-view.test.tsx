// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CustomizationSectionView,
	invalidateExtensionInventoryCache,
} from "./extensions-view";

const { fetchMarketplaceCatalog, invoke } = vi.hoisted(() => ({
	fetchMarketplaceCatalog: vi.fn(),
	invoke: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
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
});

describe("CustomizationSectionView Agent Plugin inventory", () => {
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
});
