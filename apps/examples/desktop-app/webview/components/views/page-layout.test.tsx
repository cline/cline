// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageFrame, PageHeader } from "./page-layout";

let container: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
	static instances: ResizeObserverStub[] = [];
	readonly observed = new Set<Element>();
	readonly disconnect = vi.fn(() => this.observed.clear());

	constructor(readonly callback: ResizeObserverCallback) {
		ResizeObserverStub.instances.push(this);
	}

	observe(target: Element) {
		this.observed.add(target);
	}

	unobserve(target: Element) {
		this.observed.delete(target);
	}

	resize() {
		this.callback([], this as unknown as ResizeObserver);
	}
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	ResizeObserverStub.instances = [];
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	container.remove();
});

function pageRoot() {
	const element = container.querySelector<HTMLElement>(
		'[data-slot="scroll-area"]',
	);
	if (!element) throw new Error("Missing page scroll area");
	return element;
}

function pageViewport() {
	const element = pageRoot().querySelector<HTMLElement>(
		'[data-slot="scroll-area-viewport"]',
	);
	if (!element) throw new Error("Missing page viewport");
	return element;
}

async function scroll(element: HTMLElement, top: number) {
	await act(async () => {
		element.scrollTop = top;
		element.dispatchEvent(new Event("scroll"));
	});
}

describe("PageFrame", () => {
	it("preserves ordinary page headers and frame class overrides", async () => {
		await act(async () =>
			root.render(
				<PageFrame className="legacy-frame" contentClassName="legacy-content">
					<PageHeader
						actions={<button type="button">Add item</button>}
						className="legacy-header"
						description="Manage existing items."
						meta={<span>12</span>}
						title="Items"
					/>
					<p>Page content</p>
				</PageFrame>,
			),
		);

		const heading = container.querySelector("h1");
		const frame = container.querySelector(".legacy-frame");
		const description = Array.from(container.querySelectorAll("p")).find(
			(element) => element.textContent === "Manage existing items.",
		);
		expect(heading?.textContent).toBe("Items");
		expect(heading?.classList.contains("text-3xl")).toBe(true);
		expect(heading?.classList.contains("font-semibold")).toBe(true);
		expect(description?.classList.contains("text-base")).toBe(true);
		expect(frame?.classList.contains("py-10")).toBe(true);
		expect(frame?.classList.contains("pt-4")).toBe(false);
		expect(heading?.closest(".legacy-header")).not.toBeNull();
		expect(heading?.closest(".legacy-content")).not.toBeNull();
		expect(heading?.closest(".legacy-frame")).not.toBeNull();
		expect(container.textContent).toContain("Manage existing items.");
		expect(container.textContent).toContain("12");
		expect(container.querySelector("button")?.textContent).toBe("Add item");
		expect(container.textContent).toContain("Page content");

		await scroll(pageViewport(), 100);
		expect(heading?.classList.contains("text-3xl")).toBe(true);
	});

	it("measures the header and viewport without navigation and updates on resize", async () => {
		let headerHeight = 64;
		let viewportHeight = 600;
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				const height =
					this.tagName === "HEADER"
						? headerHeight
						: this.dataset.slot === "scroll-area"
							? viewportHeight
							: 0;
				return new DOMRect(0, 0, 1200, height);
			},
		);
		await act(async () =>
			root.render(
				<PageFrame header={{ title: "Items" }}>
					<p>Page content</p>
				</PageFrame>,
			),
		);

		const frame = pageRoot();
		expect(frame.style.getPropertyValue("--page-header-height")).toBe("64px");
		expect(frame.style.getPropertyValue("--page-navigation-height")).toBe(
			"0px",
		);
		expect(frame.style.getPropertyValue("--page-viewport-height")).toBe(
			"600px",
		);
		const observer = ResizeObserverStub.instances.find((instance) =>
			instance.observed.has(frame),
		);
		expect(observer).toBeDefined();

		headerHeight = 112;
		viewportHeight = 480;
		await act(async () => observer?.resize());
		expect(frame.style.getPropertyValue("--page-header-height")).toBe("112px");
		expect(frame.style.getPropertyValue("--page-viewport-height")).toBe(
			"480px",
		);

		await act(async () => root.render(null));
		expect(observer?.disconnect).toHaveBeenCalledOnce();
	});

	it("measures optional navigation for the content's sticky offset", async () => {
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				return new DOMRect(0, 0, 1200, this.tagName === "NAV" ? 96 : 64);
			},
		);
		await act(async () =>
			root.render(
				<PageFrame
					header={{ title: "Items" }}
					navigation={<button type="button">Browse</button>}
					navigationLabel="Item sections"
				>
					<p>Page content</p>
				</PageFrame>,
			),
		);

		expect(
			container.querySelector('nav[aria-label="Item sections"]')?.textContent,
		).toBe("Browse");
		expect(pageRoot().style.getPropertyValue("--page-navigation-height")).toBe(
			"96px",
		);
	});

	it("compacts the shared header only when the page viewport scrolls", async () => {
		await act(async () =>
			root.render(
				<PageFrame header={{ title: "Items" }}>
					<ScrollArea>
						<p>Independently scrolling content</p>
					</ScrollArea>
				</PageFrame>,
			),
		);

		const heading = container.querySelector("h1");
		const nestedViewport = pageViewport().querySelector<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		expect(nestedViewport).not.toBeNull();
		if (!nestedViewport) throw new Error("Missing nested viewport");
		await scroll(nestedViewport, 100);
		expect(heading?.classList.contains("text-2xl")).toBe(true);

		await scroll(pageViewport(), 100);
		expect(heading?.classList.contains("text-lg")).toBe(true);
		await scroll(pageViewport(), 0);
		expect(heading?.classList.contains("text-2xl")).toBe(true);
	});

	it("keeps header controls mounted and focused while resetting to bounded content", async () => {
		const render = async (scrollMode: "page" | "content") => {
			await act(async () =>
				root.render(
					<PageFrame
						header={{
							title: "Items",
							actions: <input aria-label="Search items" type="search" />,
						}}
						scrollMode={scrollMode}
					>
						<p>{scrollMode === "page" ? "Browse" : "Search results"}</p>
					</PageFrame>,
				),
			);
		};
		await render("page");
		const input = container.querySelector<HTMLInputElement>("input");
		expect(input).not.toBeNull();
		if (!input) throw new Error("Missing header search");
		input.focus();
		input.value = "calendar";
		await scroll(pageViewport(), 100);
		expect(container.querySelector("h1")?.classList.contains("text-lg")).toBe(
			true,
		);

		await render("content");
		expect(pageViewport().scrollTop).toBe(0);
		expect(container.querySelector("input")).toBe(input);
		expect(document.activeElement).toBe(input);
		expect(input.value).toBe("calendar");
		expect(container.querySelector("h1")?.classList.contains("text-2xl")).toBe(
			true,
		);
		await scroll(pageViewport(), 100);
		expect(container.querySelector("h1")?.classList.contains("text-2xl")).toBe(
			true,
		);

		await render("page");
		expect(container.querySelector("input")).toBe(input);
		expect(document.activeElement).toBe(input);
		expect(input.value).toBe("calendar");
	});
});
