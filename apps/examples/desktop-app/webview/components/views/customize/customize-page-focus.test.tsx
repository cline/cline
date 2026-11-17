// @vitest-environment jsdom

import {
	act,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	type DetailNavigationHost,
	DetailNavigationProvider,
} from "@/lib/detail-navigation";
import {
	createNavigationHistory,
	navigationHistoryReducer,
} from "@/lib/navigation-history";
import { CustomizePage } from "./customize-page";
import type { InstalledCustomizationActions } from "./installed-customization-sections";

vi.mock("@/lib/use-marketplace-directory", () => ({
	MarketplaceActionsProvider: ({ children }: { children: ReactNode }) =>
		children,
}));
vi.mock("./navigation/customize-category-filter", () => ({
	CustomizeCategoryFilterProvider: ({ children }: { children: ReactNode }) =>
		children,
	useCustomizeCategoryFilter: () => null,
}));
vi.mock("./marketplace/marketplace-explorer-view", () => ({
	MarketplaceExplorerView: () => null,
}));
vi.mock("./search/customize-search-results", () => ({
	CustomizeSearchResults: () => null,
}));
vi.mock("./manage-customizations-view", () => ({
	ManageCustomizationsView: ({
		actions,
	}: {
		actions: InstalledCustomizationActions;
	}) => (
		<div data-slot="scroll-area-viewport" data-testid="inventory">
			<button
				type="button"
				onClick={(event) => actions.onCreateMcp(event.currentTarget)}
			>
				Open detail
			</button>
			<button
				type="button"
				onClick={(event) => actions.onCreateMcp(event.currentTarget)}
			>
				Open another detail
			</button>
		</div>
	),
}));
vi.mock("./customization-detail-view", () => ({
	CustomizationDetailView: ({ onBack }: { onBack: () => void }) => {
		const backRef = useRef<HTMLButtonElement>(null);
		useEffect(() => backRef.current?.focus(), []);
		return (
			<button type="button" ref={backRef} onClick={() => onBack()}>
				Back to list
			</button>
		);
	},
}));

const appHistory = { back: () => {}, forward: () => {}, browse: () => {} };

type HistoryLocation = {
	customizeSection: "browse" | "manage";
	detail?: object;
};

function HostedCustomizeHarness() {
	const [history, setHistory] = useState(() =>
		createNavigationHistory<HistoryLocation>({ customizeSection: "manage" }),
	);
	const current = history.current;
	const host = useMemo<DetailNavigationHost>(
		() => ({
			detail: current.detail,
			open: (detail) =>
				setHistory((history) =>
					navigationHistoryReducer(history, {
						type: "navigate",
						destination: { ...history.current, detail },
					}),
				),
			replace: (expected, replacement) =>
				setHistory((history) =>
					history.current.detail === expected
						? navigationHistoryReducer(history, {
								type: "replace",
								destination: { ...history.current, detail: replacement },
							})
						: history,
				),
			close: (expected, options) =>
				setHistory((history) => {
					if (history.current.detail !== expected) return history;
					const next = navigationHistoryReducer(history, { type: "back" });
					if (!options?.forget) return next;
					return {
						...next,
						back: next.back.filter((location) => location.detail !== expected),
						forward: next.forward.filter(
							(location) => location.detail !== expected,
						),
					};
				}),
		}),
		[current],
	);
	appHistory.back = () =>
		setHistory((history) =>
			navigationHistoryReducer(history, { type: "back" }),
		);
	appHistory.forward = () =>
		setHistory((history) =>
			navigationHistoryReducer(history, { type: "forward" }),
		);
	appHistory.browse = () =>
		setHistory((history) =>
			navigationHistoryReducer(history, {
				type: "navigate",
				destination: { customizeSection: "browse" },
			}),
		);
	const [renders, setRenders] = useState(0);
	return (
		<>
			<button type="button" onClick={() => setRenders(renders + 1)}>
				Other control {renders}
			</button>
			<DetailNavigationProvider value={host}>
				<CustomizePage
					section={current.customizeSection}
					customizeCategory="mcp"
					onCustomizeCategoryChange={() => {}}
					onNavigateSection={() => {}}
					onOpenModelProviders={() => {}}
				/>
			</DetailNavigationProvider>
		</>
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
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

function button(label: string) {
	const found = [
		...container.querySelectorAll<HTMLButtonElement>("button"),
	].find((candidate) => candidate.textContent === label);
	expect(found, `Button ${label}`).toBeDefined();
	return found as HTMLButtonElement;
}

it("restores the card and scroll position on repeated Back/Forward visits without stealing later focus", async () => {
	await act(async () => root.render(<HostedCustomizeHarness />));
	const trigger = button("Open detail");
	const viewport = container.querySelector<HTMLElement>(
		'[data-testid="inventory"]',
	);
	expect(viewport).not.toBeNull();
	if (!viewport) return;
	viewport.scrollTop = 180;
	await act(async () => trigger.click());

	for (let visit = 0; visit < 3; visit++) {
		expect(document.activeElement).toBe(button("Back to list"));
		viewport.scrollTop = 0;
		await act(async () => appHistory.back());
		expect(document.activeElement).toBe(trigger);
		expect(viewport.scrollTop).toBe(180);

		const other = button(`Other control ${visit}`);
		other.focus();
		viewport.scrollTop = 240;
		await act(async () => other.click());
		expect(document.activeElement).toBe(other);
		expect(viewport.scrollTop).toBe(240);
		if (visit < 2) await act(async () => appHistory.forward());
	}
});

it("does not restore another detail's remembered card and scroll position", async () => {
	await act(async () => root.render(<HostedCustomizeHarness />));
	const viewport = container.querySelector<HTMLElement>(
		'[data-testid="inventory"]',
	);
	expect(viewport).not.toBeNull();
	if (!viewport) return;
	viewport.scrollTop = 180;
	await act(async () => button("Open detail").click());
	// History can also contain consecutive details, each opened from its own card.
	viewport.scrollTop = 320;
	const otherTrigger = button("Open another detail");
	await act(async () => otherTrigger.click());
	await act(async () => appHistory.back());
	viewport.scrollTop = 0;
	await act(async () => appHistory.back());
	expect(document.activeElement).not.toBe(otherTrigger);
	expect(viewport.scrollTop).toBe(0);
});

it("forgets the retained position after leaving its section", async () => {
	await act(async () => root.render(<HostedCustomizeHarness />));
	await act(async () => button("Open detail").click());
	await act(async () => appHistory.browse());
	await act(async () => appHistory.back());
	const trigger = button("Open detail");
	const viewport = container.querySelector<HTMLElement>(
		'[data-testid="inventory"]',
	);
	expect(viewport).not.toBeNull();
	if (!viewport) return;
	viewport.scrollTop = 240;
	await act(async () => appHistory.back());
	expect(document.activeElement).not.toBe(trigger);
	expect(viewport.scrollTop).toBe(240);
});
