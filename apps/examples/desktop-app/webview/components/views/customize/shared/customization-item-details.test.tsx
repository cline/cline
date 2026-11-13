// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomizationItemDetails } from "./customization-item-details";

vi.mock("@/components/ui/scroll-area", () => ({
	ScrollArea: ({ children }: { children: ReactNode }) => (
		<div data-slot="scroll-area-viewport">{children}</div>
	),
}));

class ResizeObserverStub {
	static instances: ResizeObserverStub[] = [];
	readonly observed = new Set<Element>();
	disconnected = false;

	constructor(readonly callback: ResizeObserverCallback) {
		ResizeObserverStub.instances.push(this);
	}

	observe(element: Element) {
		this.observed.add(element);
	}

	disconnect() {
		this.observed.clear();
		this.disconnected = true;
	}
}

function Harness({ title = "Browser tools" }: { title?: string }) {
	return (
		<div data-slot="scroll-area-viewport" data-test-viewport="">
			<CustomizationItemDetails
				title={title}
				header={(titleRef) => (
					<h2 ref={titleRef} data-original-title="">
						{title}
					</h2>
				)}
				actions={null}
				categories={[]}
			>
				<div data-nested-scroll="">Long plugin documentation</div>
			</CustomizationItemDetails>
		</div>
	);
}

let container: HTMLDivElement;
let root: Root;
let geometry: {
	viewportTop: number;
	titleBottom: number;
	headerHeight: number;
	headerPaddingBottom: number;
};

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	ResizeObserverStub.instances = [];
	geometry = {
		viewportTop: 100,
		titleBottom: 240,
		headerHeight: 60,
		headerPaddingBottom: 16,
	};
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			if (this.hasAttribute("data-test-viewport"))
				return new DOMRect(0, geometry.viewportTop, 800, 700);
			if (this.hasAttribute("data-original-title"))
				return new DOMRect(0, geometry.titleBottom - 32, 400, 32);
			if (this.hasAttribute("data-visible"))
				return new DOMRect(0, geometry.viewportTop, 600, geometry.headerHeight);
			return new DOMRect(0, 0, 800, 1200);
		},
	);
	const getStyle = window.getComputedStyle.bind(window);
	vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
		const style = getStyle(element, pseudo);
		if (element.hasAttribute("data-visible"))
			style.setProperty("padding-bottom", `${geometry.headerPaddingBottom}px`);
		return style;
	});
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

async function render(props: { title?: string } = {}) {
	await act(async () => root.render(<Harness {...props} />));
}

async function scroll(selector = "[data-test-viewport]") {
	await act(async () => element(selector).dispatchEvent(new Event("scroll")));
}

async function resize(target: Element) {
	const observers = ResizeObserverStub.instances.filter((observer) =>
		observer.observed.has(target),
	);
	expect(observers.length).toBeGreaterThan(0);
	await act(async () => {
		for (const observer of observers)
			observer.callback([], observer as unknown as ResizeObserver);
	});
}

describe("Customization item compact scroll title", () => {
	it("keeps the original heading and shows the compact title only after crossing its bottom edge", async () => {
		await render();
		const original = element("[data-original-title]");
		const compact = element("[data-visible]");
		expect(original.textContent).toBe("Browser tools");
		expect(original.closest('[hidden], [aria-hidden="true"]')).toBeNull();
		expect(compact.getAttribute("data-visible")).toBe("false");
		expect(compact.closest('[aria-hidden="true"]')).not.toBeNull();
		expect(container.querySelectorAll("h2")).toHaveLength(1);

		// Viewport top 100 + header height 60 - bottom padding 16 = 144.
		geometry.titleBottom = 145;
		await scroll();
		expect(compact.getAttribute("data-visible")).toBe("false");
		geometry.titleBottom = 144;
		await scroll();
		expect(compact.getAttribute("data-visible")).toBe("true");
		geometry.titleBottom = 80;
		await scroll();
		expect(compact.getAttribute("data-visible")).toBe("true");
		geometry.titleBottom = 240;
		await scroll();
		expect(compact.getAttribute("data-visible")).toBe("false");
		expect(element("[data-original-title]")).toBe(original);
	});

	it("rechecks wrapped titles and layout, viewport, and sticky header resizing", async () => {
		await render();
		const original = element("[data-original-title]");
		const compact = element("[data-visible]");
		const layout = original.closest("header")?.parentElement;
		if (!layout) throw new Error("Missing item layout");

		geometry.titleBottom = 140;
		await resize(original);
		expect(compact.getAttribute("data-visible")).toBe("true");
		geometry.titleBottom = 200;
		await resize(layout);
		expect(compact.getAttribute("data-visible")).toBe("false");
		geometry.viewportTop = 170;
		await resize(element("[data-test-viewport]"));
		expect(compact.getAttribute("data-visible")).toBe("true");
		geometry.headerHeight = 40;
		await resize(compact);
		expect(compact.getAttribute("data-visible")).toBe("false");
	});

	it("updates changed titles, remeasures their new layout, and cleans up on unmount", async () => {
		geometry.titleBottom = 120;
		await render();
		expect(element("[data-visible]").getAttribute("data-visible")).toBe("true");
		geometry.titleBottom = 260;
		await render({ title: "Longer replacement plugin title" });
		expect(element("[data-visible]").textContent).toBe(
			"Longer replacement plugin title",
		);
		expect(element("[data-original-title]").textContent).toBe(
			"Longer replacement plugin title",
		);
		await resize(element("[data-original-title]"));
		expect(element("[data-visible]").getAttribute("data-visible")).toBe(
			"false",
		);
		await act(async () => root.render(null));
		expect(
			ResizeObserverStub.instances.every((observer) => observer.disconnected),
		).toBe(true);
	});

	it("ignores nested content scrolling until the page viewport scrolls", async () => {
		await render();
		geometry.titleBottom = 100;
		await scroll("[data-nested-scroll]");
		expect(element("[data-visible]").getAttribute("data-visible")).toBe(
			"false",
		);
		await scroll();
		expect(element("[data-visible]").getAttribute("data-visible")).toBe("true");
	});
});
