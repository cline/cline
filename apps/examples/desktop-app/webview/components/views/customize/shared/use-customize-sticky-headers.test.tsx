// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomizeStickyHeaders } from "./use-customize-sticky-headers";

class ResizeObserverStub {
	static instances: ResizeObserverStub[] = [];
	readonly observed = new Set<Element>();

	constructor(readonly callback: ResizeObserverCallback) {}

	observe(element: Element) {
		this.observed.add(element);
		if (!ResizeObserverStub.instances.includes(this))
			ResizeObserverStub.instances.push(this);
	}

	disconnect() {
		this.observed.clear();
	}
}

const browsePills = [
	["All", 50],
	["Connectors", 160],
	["Plugins", 90],
	["Skills", 80],
	["MCP", 65],
] as const;
const managePills = [
	...browsePills,
	["Tools", 80],
	["Rules", 75],
	["Hooks", 85],
] as const;

let container: HTMLDivElement;
let root: Root;
let geometry: {
	searchWidth: number;
	filterWidth: number;
	toolbarHeight: number;
	toolbarTop: number;
	headerTop: number;
	titleBaseline: number;
	pillBaseline: number;
};

function Harness({ mode = "browse" }: { mode?: "browse" | "manage" }) {
	const { contentRef, categoriesRef } = useCustomizeStickyHeaders();
	return (
		<div data-slot="scroll-area-viewport">
			<header data-page-header="">
				<div data-geometry="header-content" style={{ columnGap: 24 }}>
					<h1>
						Customize
						<span aria-hidden="true" data-customize-title-baseline="" />
					</h1>
					<div data-page-header-actions="">
						<input aria-label="Search customizations" />
					</div>
				</div>
			</header>
			<div ref={contentRef} data-customize-sections="">
				<div ref={categoriesRef} data-customize-toolbar="">
					<div style={{ columnGap: 12 }}>
						<div
							data-customize-category-page={mode}
							style={{ columnGap: 4, paddingLeft: 4, paddingRight: 4 }}
						>
							{(mode === "browse" ? browsePills : managePills).map(
								([label, width]) => (
									// biome-ignore lint/a11y/useSemanticElements: Match Radix's button-based pill controls.
									<button
										key={label}
										type="button"
										role="radio"
										aria-checked={label === "All"}
										data-width={width}
									>
										{label}
										{label === "All" && (
											<span
												aria-hidden="true"
												data-customize-pill-baseline=""
											/>
										)}
									</button>
								),
							)}
						</div>
						<div data-customize-toolbar-actions="">
							<button type="button">All categories</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	ResizeObserverStub.instances = [];
	geometry = {
		searchWidth: 280,
		filterWidth: 140,
		toolbarHeight: 56,
		toolbarTop: 160,
		headerTop: 0,
		titleBaseline: 36,
		pillBaseline: 36,
	};
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			if (this.hasAttribute("data-page-header"))
				return new DOMRect(0, geometry.headerTop, 1400, 64);
			if (this.hasAttribute("data-customize-title-baseline"))
				return new DOMRect(
					162,
					geometry.headerTop + geometry.titleBaseline,
					0,
					0,
				);
			if (this.hasAttribute("data-customize-pill-baseline"))
				return new DOMRect(
					340,
					geometry.toolbarTop + geometry.pillBaseline,
					0,
					0,
				);
			if (this.hasAttribute("data-customize-sections"))
				return new DOMRect(300, 160, 1100, 1500);
			if (this.hasAttribute("data-page-header-actions"))
				return new DOMRect(
					1400 - geometry.searchWidth,
					12,
					geometry.searchWidth,
					40,
				);
			if (this.hasAttribute("data-customize-toolbar-actions"))
				return new DOMRect(0, 0, geometry.filterWidth, 36);
			if (this.hasAttribute("data-customize-toolbar"))
				return new DOMRect(
					300,
					geometry.toolbarTop,
					1100,
					geometry.toolbarHeight,
				);
			if (this.matches('[role="radio"]'))
				return new DOMRect(0, 0, Number(this.dataset.width), 36);
			if (this.tagName === "H1") return new DOMRect(32, 16, 130, 32);
			return new DOMRect(0, 0, 1400, 64);
		},
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function element(selector: string) {
	const match = container.querySelector<HTMLElement>(selector);
	if (!match) throw new Error(`Missing ${selector}`);
	return match;
}

function toolbarTop() {
	return element("[data-customize-sections]").style.getPropertyValue(
		"--customize-toolbar-top",
	);
}

async function resize(selector: string) {
	const target = element(selector);
	const observers = ResizeObserverStub.instances.filter((observer) =>
		observer.observed.has(target),
	);
	expect(observers.length).toBeGreaterThan(0);
	await act(async () => {
		for (const observer of observers)
			observer.callback([], observer as unknown as ResizeObserver);
	});
}

describe("Customize sticky toolbar sizing", () => {
	it("aligns docked text baselines as the title compacts and the page scrolls", async () => {
		geometry.headerTop = 40;
		geometry.titleBaseline = 34;
		await act(async () => root.render(<Harness />));
		expect(toolbarTop()).toBe("-2px");

		// Scrolling moves each container independently without changing its baseline offset.
		geometry.headerTop = 0;
		geometry.toolbarTop = -2;
		await resize("[data-customize-toolbar]");
		expect(toolbarTop()).toBe("-2px");

		// The title's font transition changes its baseline while controls keep their size.
		geometry.titleBaseline = 32.25;
		await resize("h1");
		expect(toolbarTop()).toBe("-3.75px");

		geometry.searchWidth = 500;
		await resize("[data-page-header-actions]");
		expect(toolbarTop()).toBe("var(--page-content-top, 0px)");
	});

	it("uses a separate row when Manage's extra categories cannot fit the same header", async () => {
		await act(async () => root.render(<Harness />));
		expect(toolbarTop()).toBe("0px");

		// The viewport stays fixed; only the inventory's categories change.
		await act(async () => root.render(<Harness mode="manage" />));
		expect(toolbarTop()).toBe("var(--page-content-top, 0px)");
		expect(
			element("[data-customize-sections]").style.getPropertyValue(
				"--customize-toolbar-end",
			),
		).toBe("0px");

		await act(async () => root.render(<Harness />));
		expect(toolbarTop()).toBe("0px");
	});

	it("rechecks available space when the category filter or search field changes width", async () => {
		await act(async () => root.render(<Harness />));
		expect(toolbarTop()).toBe("0px");

		geometry.filterWidth = 330;
		await resize("[data-customize-toolbar-actions]");
		expect(toolbarTop()).toBe("var(--page-content-top, 0px)");

		geometry.filterWidth = 140;
		await resize("[data-customize-toolbar-actions]");
		expect(toolbarTop()).toBe("0px");

		geometry.searchWidth = 500;
		await resize("[data-page-header-actions]");
		expect(toolbarTop()).toBe("var(--page-content-top, 0px)");
	});

	it("keeps section headings below the full toolbar when its controls wrap", async () => {
		await act(async () => root.render(<Harness mode="manage" />));
		geometry.toolbarHeight = 104;
		await resize("[data-customize-toolbar]");
		expect(
			element("[data-customize-sections]").style.getPropertyValue(
				"--customize-section-top",
			),
		).toBe(
			"max(var(--page-header-height, 0px), calc(var(--customize-toolbar-top) + 104px))",
		);
	});

	it("preserves focused controls while the filter moves into its sticky position", async () => {
		await act(async () => root.render(<Harness />));
		const filter = element("[data-customize-toolbar-actions] button");
		filter.focus();
		const content = element("[data-customize-sections]");
		expect(
			Number.parseFloat(
				content.style.getPropertyValue("--customize-filter-offset"),
			),
		).toBeGreaterThan(0);

		geometry.toolbarTop = 0;
		await act(async () => {
			element('[data-slot="scroll-area-viewport"]').dispatchEvent(
				new Event("scroll"),
			);
		});
		expect(content.style.getPropertyValue("--customize-filter-offset")).toBe(
			"0px",
		);
		expect(element("[data-customize-toolbar-actions] button")).toBe(filter);
		expect(document.activeElement).toBe(filter);
		expect(toolbarTop()).toBe("0px");
	});
});
