// @vitest-environment jsdom

import { act, type ReactNode, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceEntry } from "@/lib/marketplace";
import type { InstalledCustomizationActions } from "../installed-customization-sections";
import type { CustomizeSearchState } from "./customize-search-state";

type SearchModelOptions = {
	searchQuery: string;
	searchResults: boolean;
	onOpenDetail?: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
};
type SearchSource = "installed" | "marketplace";
type SearchModel = {
	summary: CustomizeSearchState;
	rows: string[];
};

const mocks = vi.hoisted(() => ({
	options: {} as Partial<Record<SearchSource, SearchModelOptions>>,
	reporters: {} as Partial<
		Record<SearchSource, (state: CustomizeSearchState) => void>
	>,
	models: {} as Partial<Record<SearchSource, SearchModel>>,
	renderedModels: {} as Partial<Record<SearchSource, SearchModel>>,
	installedActions: undefined as InstalledCustomizationActions | undefined,
	rows: { installed: [] as string[], marketplace: [] as string[] },
}));

// Source models resolve independently of the result components in these shell tests.
function useTestSearchModel(source: SearchSource, options: SearchModelOptions) {
	const query = options.searchQuery.trim().toLowerCase();
	const activeQuery = useRef(query);
	activeQuery.current = query;
	const [state, setState] = useState<CustomizeSearchState>();
	mocks.options[source] = options;
	mocks.reporters[source] = (next) => {
		if (next.query === activeQuery.current) setState(next);
	};
	const summary =
		state?.query === query
			? state
			: { query, count: 0, loading: true, error: false };
	const model = { summary, rows: mocks.rows[source] };
	mocks.models[source] = model;
	return model;
}

vi.mock("@/components/ui/scroll-area", () => ({
	ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../use-installed-customizations", () => ({
	useInstalledCustomizations: (options: SearchModelOptions) =>
		useTestSearchModel("installed", options),
}));
vi.mock("../marketplace/use-marketplace-results", () => ({
	useMarketplaceResults: (options: SearchModelOptions) =>
		useTestSearchModel("marketplace", options),
}));
vi.mock("../installed-customization-sections", () => ({
	InstalledCustomizationSections: ({
		model,
		actions,
	}: {
		model: SearchModel;
		actions: InstalledCustomizationActions;
	}) => {
		mocks.installedActions = actions;
		mocks.renderedModels.installed = model;
		return model.rows.map((row) => <article key={row}>{row}</article>);
	},
}));
vi.mock("../marketplace/marketplace-results", () => ({
	MarketplaceResults: ({ model }: { model: SearchModel }) => {
		mocks.renderedModels.marketplace = model;
		return model.rows.map((row) => <article key={row}>{row}</article>);
	},
}));

import { CustomizeSearchResults } from "./customize-search-results";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	mocks.options = {};
	mocks.reporters = {};
	mocks.models = {};
	mocks.renderedModels = {};
	mocks.installedActions = undefined;
	mocks.rows = { installed: [], marketplace: [] };
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

function hostActions(): InstalledCustomizationActions {
	return {
		onCreateMcp: vi.fn(),
		onOpenModelProviders: vi.fn(),
		onOpenPlugin: vi.fn(),
		onOpenSkill: vi.fn(),
		onOpenRule: vi.fn(),
		onOpenWorkflow: vi.fn(),
		onOpenMcp: vi.fn(),
	};
}

function SearchResults({ query }: { query: string }) {
	return (
		<CustomizeSearchResults
			query={query}
			actions={hostActions()}
			onOpenMarketplaceDetail={() => {}}
		/>
	);
}

function status() {
	return container.querySelector("output")?.textContent?.trim();
}

function section(source: SearchSource) {
	return container.querySelector<HTMLElement>(
		`[aria-label="${source === "installed" ? "Installed" : "Marketplace"} search results"]`,
	);
}

async function report(
	source: SearchSource,
	state: CustomizeSearchState,
	rows: string[] = [],
) {
	mocks.rows[source] = rows;
	await act(async () => mocks.reporters[source]?.(state));
}

describe("Combined Customize search results", () => {
	it("combines both sources' counts and cards while keeping their existing actions connected", async () => {
		const actions = hostActions();
		const { onOpenModelProviders, onOpenSkill, onOpenMcp } = actions;
		const onOpenMarketplaceDetail = vi.fn();
		await act(async () =>
			root.render(
				<CustomizeSearchResults
					query="  CALENDAR  "
					actions={actions}
					onOpenMarketplaceDetail={onOpenMarketplaceDetail}
				/>,
			),
		);
		expect(status()).toBe("Searching customizations…");
		for (const source of ["installed", "marketplace"] as const) {
			expect(mocks.options[source]).toMatchObject({
				searchQuery: "  CALENDAR  ",
				searchResults: true,
			});
			expect(section(source)?.hidden).toBe(true);
		}

		await report(
			"installed",
			{ query: "calendar", count: 1, loading: false, error: false },
			["My calendar workflow"],
		);
		expect(status()).toBe("Searching customizations…");
		expect(section("installed")?.hidden).toBe(false);
		expect(section("installed")?.textContent).toContain("My calendar workflow");
		await report(
			"marketplace",
			{ query: "calendar", count: 2, loading: false, error: false },
			["Calendar connector", "Calendar skill"],
		);
		expect(status()).toBe("3 results");
		expect(section("marketplace")?.hidden).toBe(false);
		expect(section("marketplace")?.textContent).toContain("Calendar connector");
		expect(section("marketplace")?.textContent).toContain("Calendar skill");
		for (const source of ["installed", "marketplace"] as const) {
			expect(mocks.renderedModels[source]).toBe(mocks.models[source]);
		}
		expect(mocks.installedActions).toBe(actions);
		const trigger = document.createElement("button");
		const entry: MarketplaceEntry = {
			id: "calendar",
			type: "skill",
			name: "Calendar skill",
			tagline: "Calendar workflow",
			description: "Manage a calendar",
			tags: [],
			install: { command: "", args: [] },
		};
		mocks.installedActions?.onOpenModelProviders();
		mocks.installedActions?.onOpenSkill({ entry }, trigger);
		mocks.installedActions?.onOpenMcp(
			{ entry: { ...entry, type: "mcp" } },
			trigger,
		);
		mocks.options.marketplace?.onOpenDetail?.(entry, trigger);
		expect(onOpenModelProviders).toHaveBeenCalledOnce();
		expect(onOpenSkill).toHaveBeenCalledExactlyOnceWith({ entry }, trigger);
		expect(onOpenMcp).toHaveBeenCalledExactlyOnceWith(
			{ entry: { ...entry, type: "mcp" } },
			trigger,
		);
		expect(onOpenMarketplaceDetail).toHaveBeenCalledExactlyOnceWith(
			entry,
			trigger,
		);
	});

	it.each([
		"installed",
		"marketplace",
	] as const)("retains the other source when %s fails", async (failedSource) => {
		await act(async () => root.render(<SearchResults query="calendar" />));
		const availableSource =
			failedSource === "installed" ? "marketplace" : "installed";
		await report(
			failedSource,
			{ query: "calendar", count: 0, loading: false, error: true },
			["Source unavailable"],
		);
		await report(
			availableSource,
			{ query: "calendar", count: 1, loading: false, error: false },
			["Available calendar result"],
		);
		expect(status()).toBe("1 result");
		expect(section(availableSource)?.hidden).toBe(false);
		expect(section(availableSource)?.textContent).toContain(
			"Available calendar result",
		);
		expect(section(failedSource)?.hidden).toBe(false);
		expect(section(failedSource)?.textContent).toContain("Source unavailable");
	});

	it("shows an empty result only after both sources settle without errors", async () => {
		await act(async () => root.render(<SearchResults query="  missing  " />));
		await report("installed", {
			query: "missing",
			count: 0,
			loading: false,
			error: false,
		});
		expect(status()).toBe("Searching customizations…");
		await report("marketplace", {
			query: "missing",
			count: 0,
			loading: true,
			error: false,
		});
		expect(status()).toBe("Searching customizations…");
		await report("marketplace", {
			query: "missing",
			count: 0,
			loading: false,
			error: false,
		});
		expect(status()).toBe("No customizations match “missing”.");
		expect(section("installed")?.hidden).toBe(true);
		expect(section("marketplace")?.hidden).toBe(true);

		await report("marketplace", {
			query: "missing",
			count: 0,
			loading: false,
			error: true,
		});
		expect(status()).toBe("Some search results could not be loaded.");
		expect(section("marketplace")?.hidden).toBe(false);
	});

	it("hides previous results and ignores late reports before and after the new query settles", async () => {
		await act(async () => root.render(<SearchResults query="old" />));
		const reportOldInstalled = mocks.reporters.installed;
		const reportOldMarketplace = mocks.reporters.marketplace;
		await report(
			"installed",
			{ query: "old", count: 1, loading: false, error: false },
			["Old installed result"],
		);
		await report(
			"marketplace",
			{ query: "old", count: 1, loading: false, error: false },
			["Old marketplace result"],
		);
		expect(status()).toBe("2 results");

		await act(async () => root.render(<SearchResults query="new" />));
		expect(status()).toBe("Searching customizations…");
		expect(section("installed")?.hidden).toBe(true);
		expect(section("marketplace")?.hidden).toBe(true);
		await act(async () =>
			reportOldMarketplace?.({
				query: "old",
				count: 0,
				loading: false,
				error: false,
			}),
		);
		expect(status()).toBe("Searching customizations…");
		expect(section("installed")?.hidden).toBe(true);
		expect(section("marketplace")?.hidden).toBe(true);
		await report("installed", {
			query: "new",
			count: 0,
			loading: false,
			error: false,
		});
		expect(status()).toBe("Searching customizations…");
		await report(
			"marketplace",
			{ query: "new", count: 1, loading: false, error: false },
			["New result"],
		);
		expect(status()).toBe("1 result");
		await act(async () =>
			reportOldInstalled?.({
				query: "old",
				count: 0,
				loading: false,
				error: false,
			}),
		);
		expect(status()).toBe("1 result");
		await act(async () =>
			reportOldMarketplace?.({
				query: "old",
				count: 99,
				loading: false,
				error: false,
			}),
		);
		expect(status()).toBe("1 result");
		expect(section("installed")?.hidden).toBe(true);
		expect(section("marketplace")?.hidden).toBe(false);
		expect(section("marketplace")?.textContent).toContain("New result");
		expect(container.textContent).not.toContain("Old installed result");
		expect(container.textContent).not.toContain("Old marketplace result");
	});
});
