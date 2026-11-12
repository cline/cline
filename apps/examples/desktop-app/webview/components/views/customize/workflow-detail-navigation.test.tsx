// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	invalidateExtensionInventoryCache,
	type WorkflowItem,
} from "@/lib/extension-inventory";
import { clearMarketplaceInstalledEntries } from "@/lib/marketplace-installed";
import { CustomizePage } from "./customize-page";
import type { CustomizeSection } from "./customize-sections";
import type { CustomizeTab } from "./navigation/customize-categories";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	catalog: vi.fn(),
	workflows: [] as WorkflowItem[],
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

const workflow: WorkflowItem = {
	id: "address-pr-comments",
	name: "address-pr-comments",
	instructions:
		"# Address PR comments\n\nReview **every** comment.\n\n1. Read the diff.\n2. Resolve comments.\n",
	path: "/workspace/.clinerules/workflows/address-pr-comments.md",
};

function CustomizeHarness() {
	const [section, setSection] = useState<CustomizeSection>("manage");
	const [category, setCategory] = useState<CustomizeTab>("skills");
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
	mocks.workflows = [workflow];
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
			return { workspaceRoot: "/workspace", workflows: mocks.workflows };
		if (command === "uninstall_local_primitive") {
			mocks.workflows = [];
			return { message: "Workflow deleted." };
		}
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

function visibleWorkflowPage() {
	const navigation = container.querySelector(
		'nav[aria-label="Workflow navigation"]',
	);
	expect(navigation).not.toBeNull();
	expect(navigation?.closest("[hidden]")).toBeNull();
	expect(document.querySelector('[role="dialog"]')).toBeNull();
}

function confirmationButton(label: string) {
	const dialog = document.querySelector('[role="alertdialog"]');
	if (!dialog) throw new Error("Missing workflow deletion confirmation");
	return button(label, dialog);
}

async function render() {
	await act(async () => root.render(<CustomizeHarness />));
}

describe("Workflow detail navigation", () => {
	it("opens workflows from Manage in a full page and restores list position and focus", async () => {
		await render();
		const trigger = button("View address-pr-comments details");
		const viewport = trigger.closest<HTMLElement>(
			"[data-radix-scroll-area-viewport]",
		);
		if (!viewport) throw new Error("Missing list scroll viewport");
		viewport.scrollTop = 384;
		trigger.focus();
		await act(async () => trigger.click());
		visibleWorkflowPage();
		const back = button("Back to Manage");
		expect(document.activeElement).toBe(back);
		expect(trigger.closest("[hidden]")).not.toBeNull();
		viewport.scrollTop = 0;
		await act(async () => back.click());
		expect(
			container.querySelector('nav[aria-label="Workflow navigation"]'),
		).toBeNull();
		expect(trigger.closest("[hidden]")).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(viewport.scrollTop).toBe(384);
		expect(
			container
				.querySelector(
					'[aria-label="Manage categories"] [data-customize-category="skills"]',
				)
				?.getAttribute("aria-checked"),
		).toBe("true");
	});

	it("returns from a workflow search result with its query and card focus preserved", async () => {
		await render();
		const search = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search customizations"]',
		);
		if (!search) throw new Error("Missing Customize search");
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(search, "address-pr-comments");
			search.dispatchEvent(new Event("input", { bubbles: true }));
		});
		const results = container.querySelector(
			'[aria-label="Installed search results"]',
		);
		if (!results) throw new Error("Missing installed search results");
		const trigger = button("View address-pr-comments details", results);
		await act(async () => trigger.click());
		visibleWorkflowPage();
		await act(async () => button("Back to Search results").click());
		expect(search.value).toBe("address-pr-comments");
		expect(results.closest("[hidden]")).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(button("Clear customization search")).toBeDefined();
	});

	it("shows loaded workflow instructions as Markdown and source without another backend read", async () => {
		await render();
		mocks.invoke.mockClear();
		await act(async () => button("View address-pr-comments details").click());
		const browser = container.querySelector(
			'[data-slot="file-browser"][aria-label="Workflow content"]',
		);
		if (!browser) throw new Error("Missing workflow file browser");
		const files = browser.querySelector('nav[aria-label="Workflow files"]');
		if (!files) throw new Error("Missing workflow file list");
		expect(files.querySelectorAll("button")).toHaveLength(1);
		expect(
			button("address-pr-comments.md", files).getAttribute("aria-current"),
		).toBe("page");
		expect(browser.querySelector("h1")?.textContent).toBe(
			"Address PR comments",
		);
		expect(browser.textContent).toContain("Review every comment.");
		expect(browser.textContent).not.toContain("**every**");
		expect(browser.querySelector('[aria-label="File source"]')).toBeNull();
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
		).toBe(workflow.instructions);
		await act(async () => preview.click());
		expect(preview.checked).toBe(true);
		expect(browser.querySelector("h1")?.textContent).toBe(
			"Address PR comments",
		);
		expect(browser.querySelector('[aria-label="File source"]')).toBeNull();
		expect(mocks.invoke).not.toHaveBeenCalled();
	});

	it("preserves the workflow when deletion is canceled or dismissed", async () => {
		await render();
		await act(async () => button("View address-pr-comments details").click());
		const remove = button("Delete");
		await act(async () => {
			remove.focus();
			remove.click();
		});
		const dialog = document.querySelector('[role="alertdialog"]');
		expect(dialog?.textContent).toContain("Delete workflow?");
		expect(dialog?.textContent).toContain(workflow.name);
		expect(document.activeElement).toBe(confirmationButton("Cancel"));
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"uninstall_local_primitive",
			expect.anything(),
		);
		await act(async () => confirmationButton("Cancel").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(remove));
		await act(async () => remove.click());
		await act(async () =>
			confirmationButton("Cancel").dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			),
		);
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"uninstall_local_primitive",
			expect.anything(),
		);
		expect(mocks.workflows).toEqual([workflow]);
		visibleWorkflowPage();
	});

	it("deletes the workflow file after confirmation and returns to the refreshed Manage list", async () => {
		await render();
		await act(async () => button("View address-pr-comments details").click());
		const readsBeforeDelete = mocks.invoke.mock.calls.filter(
			([command]) => command === "list_user_instruction_configs",
		).length;
		await act(async () => button("Delete").click());
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"uninstall_local_primitive",
			expect.anything(),
		);
		await act(async () => confirmationButton("Delete").click());
		expect(mocks.invoke).toHaveBeenCalledWith("uninstall_local_primitive", {
			type: "workflow",
			id: workflow.id,
			name: workflow.name,
			path: workflow.path,
		});
		expect(
			container.querySelector('nav[aria-label="Workflow navigation"]'),
		).toBeNull();
		expect(
			container.querySelector(
				'[aria-label="View address-pr-comments details"]',
			),
		).toBeNull();
		expect(
			mocks.invoke.mock.calls.filter(
				([command]) => command === "list_user_instruction_configs",
			).length,
		).toBeGreaterThan(readsBeforeDelete);
	});

	it("keeps a failed deletion on the detail page and permits retrying", async () => {
		await render();
		await act(async () => button("View address-pr-comments details").click());
		mocks.invoke.mockRejectedValueOnce(new Error("Workflow file is read-only"));
		await act(async () => button("Delete").click());
		await act(async () => confirmationButton("Delete").click());
		visibleWorkflowPage();
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Workflow file is read-only",
		);
		expect(button("Delete").disabled).toBe(false);
		expect(
			container.querySelector('[aria-label="Workflow content"]'),
		).not.toBeNull();
		await act(async () => button("Delete").click());
		await act(async () => confirmationButton("Delete").click());
		expect(
			container.querySelector('nav[aria-label="Workflow navigation"]'),
		).toBeNull();
		expect(
			mocks.invoke.mock.calls.filter(
				([command]) => command === "uninstall_local_primitive",
			),
		).toHaveLength(2);
	});
});
