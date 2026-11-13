// @vitest-environment jsdom

import { act, useMemo, useReducer, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createDesktopAppState,
	desktopAppReducer,
} from "@/lib/desktop-app-state";
import {
	type DetailNavigationHost,
	DetailNavigationProvider,
} from "@/lib/detail-navigation";
import {
	invalidateExtensionInventoryCache,
	type RuleItem,
} from "@/lib/extension-inventory";
import { clearMarketplaceInstalledEntries } from "@/lib/marketplace-installed";
import { revealActionLabel } from "@/lib/reveal-label";
import { CustomizePage } from "./customize-page";
import type { CustomizeSection } from "./customize-sections";
import type { CustomizeTab } from "./navigation/customize-categories";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	catalog: vi.fn(),
	rules: [] as RuleItem[],
	connectorStatus: { configured: false, integrations: [] },
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: () => () => {} },
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/marketplace", () => ({
	fetchMarketplaceCatalog: mocks.catalog,
	getCachedMarketplaceCatalog: () => null,
}));
vi.mock("@/lib/use-composio-catalog", () => ({
	useComposioCatalog: () => ({
		catalog: null,
		loading: false,
		error: null,
		refresh: async () => {},
	}),
}));
vi.mock("@/lib/use-composio-status", () => ({
	useComposioStatus: () => ({
		status: mocks.connectorStatus,
		loading: false,
		error: null,
		refresh: async () => {},
	}),
}));
vi.mock("@/lib/composio", () => ({
	fetchComposioStatus: async () => mocks.connectorStatus,
	getCachedComposioStatus: () => mocks.connectorStatus,
	fetchComposioToolkitCatalog: async () => ({ toolkits: [] }),
	getCachedComposioToolkitCatalog: () => null,
}));

const rule: RuleItem = {
	name: "Code conventions",
	instructions:
		"# Code conventions\n\nUse **accessible** components.\n\n1. Label controls.\n2. Preserve keyboard navigation.\n",
	path: "/workspace/.cline/rules/style.md",
};

function CustomizeHarness() {
	const [section, setSection] = useState<CustomizeSection>("manage");
	const [category, setCategory] = useState<CustomizeTab>("rules");
	return (
		<CustomizePage
			section={section}
			customizeCategory={category}
			onCustomizeCategoryChange={setCategory}
			onNavigateSection={setSection}
			onOpenModelProviders={() => {}}
		/>
	);
}

const appHistory = { back: () => {}, forward: () => {} };

/** The app shell's wiring: the open detail is a step in Back/Forward history. */
function HostedCustomizeHarness() {
	const [state, dispatch] = useReducer(
		desktopAppReducer<"General">,
		undefined,
		() => {
			const initial = createDesktopAppState("draft", "General", "local");
			return desktopAppReducer(initial, {
				type: "navigate",
				destination: {
					...initial.navigation.current,
					view: "customize",
					customizeSection: "manage",
				},
			});
		},
	);
	const [category, setCategory] = useState<CustomizeTab>("rules");
	const current = state.navigation.current;
	const host = useMemo<DetailNavigationHost>(
		() => ({
			detail: current.detail,
			open: (detail) =>
				dispatch({ type: "navigate", destination: { ...current, detail } }),
			replace: (detail) => dispatch({ type: "replace-detail", detail }),
			close: (detail, options) =>
				dispatch({ type: "close-detail", detail, forget: options?.forget }),
		}),
		[current],
	);
	appHistory.back = () => dispatch({ type: "back" });
	appHistory.forward = () => dispatch({ type: "forward" });
	return (
		<DetailNavigationProvider value={host}>
			<CustomizePage
				section={current.customizeSection}
				customizeCategory={category}
				onCustomizeCategoryChange={setCategory}
				onNavigateSection={(customizeSection) =>
					dispatch({
						type: "navigate",
						destination: { ...current, detail: undefined, customizeSection },
					})
				}
				onOpenModelProviders={() => {}}
			/>
		</DetailNavigationProvider>
	);
}

let container: HTMLDivElement;
let root: Root;

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
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	invalidateExtensionInventoryCache();
	clearMarketplaceInstalledEntries();
	mocks.rules = [rule];
	mocks.catalog.mockReset().mockResolvedValue({
		version: 1,
		counts: { total: 0, plugins: 0, skills: 0, mcps: 0 },
		tags: [],
		entries: [],
	});
	mocks.invoke.mockReset().mockImplementation(async (command: string) => {
		if (command === "list_marketplace_installed_entries")
			return { installedKeys: [] };
		if (command === "list_mcp_servers")
			return { settingsPath: "", hasSettingsFile: false, servers: [] };
		if (command === "list_user_instruction_configs")
			return { workspaceRoot: "/workspace", rules: mocks.rules };
		if (command === "reveal_path") return;
		throw new Error(`Unexpected desktop command: ${command}`);
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

function button(label: string, within: ParentNode = container) {
	const result = [...within.querySelectorAll<HTMLButtonElement>("button")].find(
		(candidate) =>
			candidate.getAttribute("aria-label") === label ||
			candidate.textContent === label,
	);
	if (!result) throw new Error(`Missing button: ${label}`);
	return result;
}

function visibleRulePage() {
	const navigation = container.querySelector(
		'nav[aria-label="Rule navigation"]',
	);
	expect(navigation).not.toBeNull();
	expect(navigation?.closest("[hidden]")).toBeNull();
	expect(document.querySelector('[role="dialog"]')).toBeNull();
}

async function render() {
	await act(async () => root.render(<CustomizeHarness />));
}

describe("Rule detail navigation", () => {
	it("opens rules from Manage and restores the category, list position, and focus", async () => {
		await render();
		const trigger = button("View details for Code conventions");
		const viewport = trigger.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!viewport) throw new Error("Missing list scroll viewport");
		viewport.scrollTop = 384;
		trigger.focus();
		await act(async () => trigger.click());
		visibleRulePage();
		const back = button("Back to Manage");
		expect(document.activeElement).toBe(back);
		expect(trigger.closest("[hidden]")).not.toBeNull();
		viewport.scrollTop = 0;
		await act(async () => back.click());
		expect(
			container.querySelector('nav[aria-label="Rule navigation"]'),
		).toBeNull();
		expect(trigger.closest("[hidden]")).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(viewport.scrollTop).toBe(384);
		expect(
			container
				.querySelector(
					'[aria-label="Manage categories"] [data-customize-category="rules"]',
				)
				?.getAttribute("aria-checked"),
		).toBe("true");
	});

	it("steps out of and back into a rule with the app's Back and Forward", async () => {
		await act(async () => root.render(<HostedCustomizeHarness />));
		const trigger = button("View details for Code conventions");
		const viewport = trigger.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!viewport) throw new Error("Missing list scroll viewport");
		viewport.scrollTop = 384;
		await act(async () => trigger.click());
		visibleRulePage();

		viewport.scrollTop = 0;
		await act(async () => appHistory.back());
		expect(
			container.querySelector('nav[aria-label="Rule navigation"]'),
		).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(viewport.scrollTop).toBe(384);

		await act(async () => appHistory.forward());
		visibleRulePage();
		// The page's own Back is the same step, so Forward reopens the rule.
		await act(async () => button("Back to Manage").click());
		expect(
			container.querySelector('nav[aria-label="Rule navigation"]'),
		).toBeNull();
		await act(async () => appHistory.forward());
		visibleRulePage();
	});

	it("returns to search results with the query and card focus preserved", async () => {
		await render();
		const search = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search customizations"]',
		);
		if (!search) throw new Error("Missing Customize search");
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(search, "Code conventions");
			search.dispatchEvent(new Event("input", { bubbles: true }));
		});
		const results = container.querySelector(
			'[aria-label="Installed search results"]',
		);
		if (!results) throw new Error("Missing installed search results");
		const trigger = button("View details for Code conventions", results);
		await act(async () => trigger.click());
		visibleRulePage();
		await act(async () => button("Back to Search results").click());
		expect(search.value).toBe("Code conventions");
		expect(results.closest("[hidden]")).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(button("Clear customization search")).toBeDefined();
	});

	it.each([
		["/workspace/.cline/rules/style.md", "Project"],
		["/workspace/.clinerules", "Project"],
		["/home/user/.cline/rules/style.md", "Global"],
	])("shows %s with its %s scope and loaded instructions without another backend read", async (path, scope) => {
		mocks.rules = [{ ...rule, path }];
		await render();
		mocks.invoke.mockClear();
		await act(async () => button("View details for Code conventions").click());
		const metadata = container.querySelector(
			'[aria-label="Installed rule details"]',
		);
		expect(metadata?.textContent).toContain(scope);
		expect(metadata?.textContent).toContain(path);
		const browser = container.querySelector(
			'[data-slot="file-browser"][aria-label="Rule content"]',
		);
		if (!browser) throw new Error("Missing rule file browser");
		const files = browser.querySelector('nav[aria-label="Rule files"]');
		if (!files) throw new Error("Missing rule file list");
		expect(files.querySelectorAll("button")).toHaveLength(1);
		expect(
			button(path.split("/").at(-1) ?? "", files).getAttribute("aria-current"),
		).toBe("page");
		expect(browser.querySelector("h1")?.textContent).toBe("Code conventions");
		expect(browser.textContent).toContain("Use accessible components.");
		expect(browser.textContent).not.toContain("**accessible**");
		const source = browser.querySelector<HTMLInputElement>(
			'input[type="radio"][value="source"]',
		);
		const preview = browser.querySelector<HTMLInputElement>(
			'input[type="radio"][value="preview"]',
		);
		if (!source || !preview) throw new Error("Missing file display controls");
		expect(preview.checked).toBe(true);
		await act(async () => source.click());
		expect(source.checked).toBe(true);
		expect(
			browser.querySelector('[aria-label="File source"] code')?.textContent,
		).toBe(rule.instructions);
		await act(async () => preview.click());
		expect(browser.querySelector("h1")?.textContent).toBe("Code conventions");
		expect(browser.querySelector('[aria-label="File source"]')).toBeNull();
		expect(mocks.invoke).not.toHaveBeenCalled();
	});

	it("reveals the rule file using its shared path menu while keeping the page open", async () => {
		await render();
		await act(async () => button("View details for Code conventions").click());
		await act(async () =>
			button("Rule path actions").dispatchEvent(
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
		if (!reveal) throw new Error("Missing the reveal action");
		await act(async () => reveal.click());
		expect(mocks.invoke).toHaveBeenCalledWith("reveal_path", {
			path: rule.path,
		});
		expect(document.querySelector('[role="menu"]')).toBeNull();
		visibleRulePage();
	});
});
