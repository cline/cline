// @vitest-environment jsdom

import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ComposioIntegrationStatus,
	ComposioStatusResponse,
} from "@/lib/composio-types";
import type { MarketplaceEntry } from "@/lib/marketplace";
import type { InstalledCustomizationActions } from "../installed-customization-sections";

const mocks = vi.hoisted(() => ({
	listeners: new Set<() => void>(),
	status: { configured: true, integrations: [] } as ComposioStatusResponse,
	catalog: {
		configured: true,
		toolkits: [
			{
				slug: "github",
				name: "GitHub",
				description: "Code hosting",
				recommended: false,
			},
		],
	},
	entries: [] as MarketplaceEntry[],
	connect: vi.fn(),
	cancel: vi.fn(),
	disconnect: vi.fn(),
	refresh: vi.fn(),
	install: vi.fn(),
}));

const subscribe = (listener: () => void) => {
	mocks.listeners.add(listener);
	return () => {
		mocks.listeners.delete(listener);
	};
};
const getStatus = () => mocks.status;

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: vi.fn(), subscribe: () => () => {} },
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/use-composio-status", () => ({
	useComposioStatus: () => ({
		status: useSyncExternalStore(subscribe, getStatus),
		loading: false,
		error: null,
		refresh: mocks.refresh,
	}),
}));
vi.mock("@/lib/use-composio-catalog", () => ({
	useComposioCatalog: () => ({
		catalog: mocks.catalog,
		loading: false,
		error: null,
		refresh: mocks.refresh,
	}),
}));
vi.mock("@/lib/use-composio-connections", () => ({
	useComposioConnections: () => ({
		actionError: null,
		busyToolkit: null,
		refreshing: false,
		refresh: mocks.refresh,
		connect: mocks.connect,
		cancelConnect: mocks.cancel,
		disconnect: mocks.disconnect,
	}),
}));
vi.mock("@/lib/use-marketplace-directory", () => ({
	useMarketplaceDirectory: () => ({
		catalog: { tags: [], entries: mocks.entries },
		loading: false,
		errorMessage: null,
		installedReady: true,
		installedLoading: false,
		installedError: null,
		installedKeys: new Set<string>(),
		actionStates: new Map(),
		tagLabels: new Map(),
		install: mocks.install,
	}),
}));

// Keep the real connector results and installed cards while omitting unrelated
// rule, skill, workflow, and MCP inventories from this search integration test.
vi.mock("../use-installed-customizations", () => ({
	useInstalledCustomizations: ({ searchQuery }: { searchQuery: string }) => {
		const connectors = useConnectorResults({
			searchQuery,
			searchResults: true,
			variant: "installed",
		});
		return { connectors, summary: connectors.summary };
	},
}));
vi.mock("../installed-customization-sections", () => ({
	InstalledCustomizationSections: ({
		model,
	}: {
		model: { connectors: ConnectorResults };
	}) => <InstalledConnectorsView model={model.connectors} searchResults />,
}));

import { InstalledConnectorsView } from "../connectors/composio-connectors-view";
import {
	type ConnectorResults,
	useConnectorResults,
} from "../connectors/use-connector-results";
import { CustomizeSearchResults } from "./customize-search-results";

let container: HTMLDivElement;
let root: Root;

function publishStatus(status: ComposioIntegrationStatus) {
	mocks.status = {
		configured: true,
		integrations: [
			{
				toolkit: "github",
				name: "GitHub",
				description: "Code hosting",
				recommended: false,
				status,
			},
		],
	};
	for (const listener of mocks.listeners) listener();
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.clearAllMocks();
	mocks.status = { configured: true, integrations: [] };
	mocks.entries = [];
	mocks.connect.mockImplementation(async () => publishStatus("pending"));
	mocks.cancel.mockImplementation(async () => publishStatus("not_connected"));
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

async function renderSearch() {
	const actions: InstalledCustomizationActions = {
		onCreateMcp: vi.fn(),
		onOpenModelProviders: vi.fn(),
		onOpenPlugin: vi.fn(),
		onOpenSkill: vi.fn(),
		onOpenRule: vi.fn(),
		onOpenWorkflow: vi.fn(),
		onOpenMcp: vi.fn(),
	};
	await act(async () =>
		root.render(
			<CustomizeSearchResults
				query="github"
				actions={actions}
				onOpenMarketplaceDetail={() => {}}
			/>,
		),
	);
}

function marketplaceSection() {
	return container.querySelector<HTMLElement>(
		'[aria-label="Marketplace search results"]',
	);
}

function dialog() {
	return document.querySelector<HTMLElement>('[role="dialog"]');
}

function dialogButton(label: string) {
	const button = [...(dialog()?.querySelectorAll("button") ?? [])].find(
		(candidate) =>
			candidate.textContent?.trim() === label ||
			candidate.getAttribute("aria-label") === label,
	);
	if (!button) throw new Error(`Expected dialog button: ${label}`);
	return button;
}

async function openGithub() {
	const opener = marketplaceSection()?.querySelector<HTMLButtonElement>(
		'[aria-label="View GitHub details"]',
	);
	if (!opener) throw new Error("Expected GitHub marketplace card");
	await act(async () => {
		opener.focus();
		opener.click();
	});
	expect(dialog()).not.toBeNull();
	return opener;
}

describe("Connector details in Customize search", () => {
	it.each([
		false,
		true,
	])("keeps authorization and Cancel in the original dialog when another marketplace result remains: %s", async (anotherResult) => {
		if (anotherResult) {
			mocks.entries = [
				{
					id: "github-helper",
					type: "skill",
					name: "GitHub helper",
					tagline: "Review code",
					description: "Review GitHub pull requests",
					tags: [],
					install: { command: "", args: [] },
				},
			];
		}
		await renderSearch();
		const opener = await openGithub();
		const originalDialog = dialog();
		await act(async () => dialogButton("Connect").click());
		expect(mocks.connect).toHaveBeenCalledExactlyOnceWith("github");
		expect(opener.isConnected).toBe(false);
		expect(marketplaceSection()?.hidden).toBe(!anotherResult);
		expect(dialog()).toBe(originalDialog);
		expect(dialog()?.closest("[hidden]")).toBeNull();
		expect(dialog()?.textContent).toContain(
			"Finish authorizing GitHub in your browser",
		);
		expect(
			container.querySelector('[aria-label="Installed search results"]')
				?.textContent,
		).toContain("Auth required");
		expect(dialogButton("Cancel").disabled).toBe(false);
		await act(async () => dialogButton("Cancel").click());
		expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("github");
		expect(dialog()).toBe(originalDialog);
		expect(dialogButton("Connect")).toBeDefined();
		expect(marketplaceSection()?.hidden).toBe(false);
	});

	it.each([
		"pending",
		"connected",
	] as const)("closes the last connector's %s dialog to the results viewport and does not reopen on status updates", async (status) => {
		await renderSearch();
		await openGithub();
		const originalDialog = dialog();
		await act(async () => dialogButton("Connect").click());
		if (status === "connected") {
			await act(async () => publishStatus("connected"));
			expect(dialogButton("Disconnect")).toBeDefined();
			expect(dialog()?.textContent).not.toContain("Finish authorizing");
		}
		expect(dialog()).toBe(originalDialog);
		await act(async () => dialogButton("Close").click());
		expect(dialog()).toBeNull();
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				container.querySelector('[data-slot="scroll-area-viewport"]'),
			),
		);
		await act(async () => publishStatus("connected"));
		expect(dialog()).toBeNull();
		await act(async () => publishStatus("not_connected"));
		expect(marketplaceSection()?.hidden).toBe(false);
		expect(dialog()).toBeNull();
	});

	it("restores focus to an available card when its dialog closes", async () => {
		await renderSearch();
		const opener = await openGithub();
		await act(async () => dialogButton("Close").click());
		expect(dialog()).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(opener));
	});
});
