// @vitest-environment jsdom

import { act, useMemo, useState } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetComposioCacheForTesting } from "@/lib/composio";
import {
	type DetailNavigationHost,
	DetailNavigationProvider,
} from "@/lib/detail-navigation";
import {
	getCachedExtensionInventory,
	invalidateExtensionInventoryCache,
	type RuleItem,
	type WorkflowItem,
} from "@/lib/extension-inventory";
import { clearMarketplaceInstalledEntries } from "@/lib/marketplace-installed";
import {
	createNavigationHistory,
	navigationHistoryReducer,
} from "@/lib/navigation-history";
import {
	CustomizeTestHarness,
	createCustomizeTestRoot,
	findButton,
} from "./customize-test-utils";
import type { CustomizeTab } from "./navigation/customize-categories";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	catalog: vi.fn(),
	rules: [] as RuleItem[],
	workflows: [] as WorkflowItem[],
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

const rule: RuleItem = {
	name: "review-guidance",
	path: "/workspace/.clinerules/review-guidance.md",
	instructions: "# Original rule\n\nOriginal rule instructions.\n",
};
const workflow: WorkflowItem = {
	id: "review-changes",
	name: "review-changes",
	path: "/workspace/.clinerules/workflows/review-changes.md",
	instructions: "# Original workflow\n\nOriginal workflow instructions.\n",
};

type HistoryLocation = { detail?: object };

function HostedCustomizeHarness({ category }: { category: CustomizeTab }) {
	const [history, setHistory] = useState(() =>
		createNavigationHistory<HistoryLocation>({}),
	);
	const host = useMemo<DetailNavigationHost>(
		() => ({
			detail: history.current.detail,
			open: (detail) =>
				setHistory((history) =>
					navigationHistoryReducer(history, {
						type: "navigate",
						destination: { detail },
					}),
				),
			replace: (expected, replacement) =>
				setHistory((history) =>
					history.current.detail === expected
						? navigationHistoryReducer(history, {
								type: "replace",
								destination: { detail: replacement },
							})
						: history,
				),
			close: (expected, options) =>
				setHistory((history) => {
					if (history.current.detail !== expected) return history;
					const next = navigationHistoryReducer(history, { type: "back" });
					return options?.forget
						? {
								...next,
								forward: next.forward.filter(
									(location) => location.detail !== expected,
								),
							}
						: next;
				}),
		}),
		[history.current.detail],
	);
	return (
		<DetailNavigationProvider value={host}>
			<button
				type="button"
				disabled={history.forward.length === 0}
				onClick={() =>
					setHistory((history) =>
						navigationHistoryReducer(history, { type: "forward" }),
					)
				}
			>
				Forward
			</button>
			<CustomizeTestHarness initialCategory={category} />
		</DetailNavigationProvider>
	);
}

let container: HTMLDivElement;
let root: Root;
let cleanup: () => Promise<void>;

beforeEach(() => {
	resetComposioCacheForTesting();
	invalidateExtensionInventoryCache();
	clearMarketplaceInstalledEntries();
	mocks.rules = [rule];
	mocks.workflows = [workflow];
	mocks.catalog.mockReset().mockResolvedValue({
		version: 1,
		counts: { total: 0, plugins: 0, skills: 0, mcps: 0 },
		tags: [],
		entries: [],
	});
	mocks.invoke.mockReset().mockImplementation(async (command: string) => {
		if (command === "composio_integrations")
			return { configured: false, integrations: [] };
		if (command === "list_marketplace_installed_entries")
			return { installedKeys: [] };
		if (command === "list_mcp_servers")
			return { settingsPath: "", hasSettingsFile: false, servers: [] };
		if (command === "list_user_instruction_configs")
			return {
				workspaceRoot: "/workspace",
				rules: mocks.rules,
				workflows: mocks.workflows,
			};
		throw new Error(`Unexpected desktop command: ${command}`);
	});
	({ container, root, cleanup } = createCustomizeTestRoot());
});

afterEach(() => cleanup());

const cases = [
	{
		type: "rule",
		label: "Rule",
		category: "rules",
		trigger: "View details for review-guidance",
		item: rule,
	},
	{
		type: "workflow",
		label: "Workflow",
		category: "skills",
		trigger: "View review-changes details",
		item: workflow,
	},
] as const;

function replaceInstructions(type: "rule" | "workflow", instructions: string) {
	if (type === "rule") mocks.rules = [{ ...rule, instructions }];
	else mocks.workflows = [{ ...workflow, instructions }];
}

function content(label: string) {
	const browser = container.querySelector<HTMLElement>(
		`[data-slot="file-browser"][aria-label="${label} content"]`,
	);
	expect(browser).not.toBeNull();
	expect(browser?.closest("[hidden]")).toBeNull();
	return browser as HTMLElement;
}

async function expectCurrentPreview(label: string, instructions: string) {
	const browser = content(label);
	expect(browser.querySelector("h1")?.textContent).toBe(`Updated ${label}`);
	expect(browser.textContent).toContain(`Updated ${label} instructions.`);
	expect(browser.textContent).not.toContain("Original");
	const source = browser.querySelector<HTMLInputElement>(
		'input[type="radio"][value="source"]',
	);
	if (!source) throw new Error("Missing source display control");
	await act(async () => source.click());
	expect(
		browser.querySelector('[aria-label="File source"] code')?.textContent,
	).toBe(instructions);
}

describe.each(cases)("$label instruction detail inventory", (testCase) => {
	it("reopens the refreshed instructions when Forward restores the saved selection", async () => {
		await act(async () =>
			root.render(<HostedCustomizeHarness category={testCase.category} />),
		);
		await act(async () => findButton(container, testCase.trigger).click());
		expect(content(testCase.label).textContent).toContain("Original");
		await act(async () => findButton(container, "Back to Manage").click());
		expect(
			container.querySelector(`[aria-label="${testCase.label} content"]`),
		).toBeNull();
		const instructions = `# Updated ${testCase.label}\n\nUpdated ${testCase.label} instructions.\n`;
		replaceInstructions(testCase.type, instructions);
		await act(async () =>
			findButton(container, "Refresh customizations").click(),
		);
		expect(
			getCachedExtensionInventory()?.[
				testCase.type === "rule" ? "rules" : "workflows"
			][0]?.instructions,
		).toBe(instructions);
		// History restores the original selection object, rather than clicking
		// the refreshed card and constructing a new one.
		expect(testCase.item.instructions).toContain("Original");
		await act(async () => findButton(container, "Forward").click());
		await expectCurrentPreview(testCase.label, instructions);
	});

	it("updates an open preview when fresh inventory is published", async () => {
		await act(async () =>
			root.render(<HostedCustomizeHarness category={testCase.category} />),
		);
		await act(async () => findButton(container, testCase.trigger).click());
		const browser = content(testCase.label);
		expect(browser.textContent).toContain("Original");
		const instructions = `# Updated ${testCase.label}\n\nUpdated ${testCase.label} instructions.\n`;
		replaceInstructions(testCase.type, instructions);
		await act(async () => invalidateExtensionInventoryCache());
		expect(content(testCase.label)).toBe(browser);
		await expectCurrentPreview(testCase.label, instructions);
	});
});
