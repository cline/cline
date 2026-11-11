// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemDetails } from "./item-details";

class ResizeObserverStub {
	static instances: ResizeObserverStub[] = [];
	readonly observed = new Set<Element>();

	constructor(readonly callback: ResizeObserverCallback) {
		ResizeObserverStub.instances.push(this);
	}

	observe(element: Element) {
		this.observed.add(element);
	}

	disconnect() {
		this.observed.clear();
	}
}

let container: HTMLDivElement;
let root: Root;
let titleBottom: number;
let headerHeight: number;
const onRun = vi.fn();
const onSave = vi.fn();
const onNameChange = vi.fn();

function Harness({ busy = false } = {}) {
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				onSave();
			}}
		>
			<ItemDetails
				title="Daily review"
				headerActions={
					<>
						<button type="button" disabled={busy} onClick={onRun}>
							Run now
						</button>
						<button type="submit" disabled={busy} aria-busy={busy}>
							{busy ? "Saving…" : "Save"}
						</button>
					</>
				}
				renderHeader={(titleRef, headerActions) => (
					<div>
						<h1 ref={titleRef}>Daily review</h1>
						<input
							aria-label="Schedule name"
							defaultValue="Daily review"
							onChange={(event) => onNameChange(event.currentTarget.value)}
						/>
						{headerActions}
					</div>
				)}
			>
				<input aria-label="Instructions" />
			</ItemDetails>
		</form>
	);
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	ResizeObserverStub.instances = [];
	titleBottom = 240;
	headerHeight = 64;
	onRun.mockClear();
	onSave.mockClear();
	onNameChange.mockClear();
	container = document.createElement("div");
	container.setAttribute("data-radix-scroll-area-viewport", "");
	container.style.setProperty("--item-details-scroll-header-height", "17px");
	document.body.appendChild(container);
	root = createRoot(container);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			if (this === container) return new DOMRect(0, 100, 800, 700);
			if (this.tagName === "H1")
				return new DOMRect(0, titleBottom - 32, 400, 32);
			if (this.hasAttribute("data-item-scroll-header"))
				return new DOMRect(0, 100, 600, headerHeight);
			return new DOMRect(0, 0, 800, 1200);
		},
	);
	const getStyle = window.getComputedStyle.bind(window);
	vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
		const style = getStyle(element, pseudo);
		if (element.hasAttribute("data-item-scroll-header"))
			style.setProperty("padding-bottom", "16px");
		return style;
	});
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function actions(location: "inline" | "sticky") {
	const element = container.querySelector<HTMLElement>(
		`[data-item-header-actions="${location}"]`,
	);
	if (!element) throw new Error(`Missing ${location} actions`);
	return element;
}

function action(location: "inline" | "sticky", index: number) {
	const button = actions(location).querySelectorAll("button")[index];
	if (!button) throw new Error(`Missing action ${index}`);
	return button;
}

async function render(props: { busy?: boolean } = {}) {
	await act(async () => root.render(<Harness {...props} />));
}

async function scroll(sticky: boolean) {
	titleBottom = sticky ? 100 : 240;
	await act(async () => container.dispatchEvent(new Event("scroll")));
}

describe("ItemDetails header actions", () => {
	it("keeps both page headers draggable while preserving editable fields and selectable body content", async () => {
		await render();
		const header = container.querySelector("header");
		const compact = container.querySelector("[data-item-scroll-header]");
		const name = container.querySelector<HTMLInputElement>(
			'input[aria-label="Schedule name"]',
		);
		if (!name) throw new Error("Missing editable schedule name");
		const bodyField = container.querySelector(
			'input[aria-label="Instructions"]',
		);
		expect(header?.getAttribute("data-tauri-drag-region")).toBe("deep");
		expect(compact?.getAttribute("data-tauri-drag-region")).toBe("deep");
		expect(compact?.getAttribute("data-visible")).toBe("false");
		expect(bodyField?.closest("[data-tauri-drag-region]")).toBeNull();
		// Native deep dragging skips interactive elements unless explicitly opted in.
		expect(name.hasAttribute("data-tauri-drag-region")).toBe(false);
		for (const location of ["inline", "sticky"] as const) {
			expect(action(location, 0).hasAttribute("data-tauri-drag-region")).toBe(
				false,
			);
			expect(action(location, 1).hasAttribute("data-tauri-drag-region")).toBe(
				false,
			);
		}
		name.focus();
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(name, "Weekly review");
			name.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(onNameChange).toHaveBeenLastCalledWith("Weekly review");
		await scroll(true);
		expect(compact?.getAttribute("data-visible")).toBe("true");
		expect(compact?.getAttribute("data-tauri-drag-region")).toBe("deep");
		expect(document.activeElement).toBe(name);
		expect(name.value).toBe("Weekly review");
	});

	it("exposes only the active actions while keeping the compact title decorative", async () => {
		await render();
		expect(actions("inline").hasAttribute("inert")).toBe(false);
		expect(actions("inline").closest('[aria-hidden="true"]')).toBeNull();
		expect(actions("sticky").hasAttribute("inert")).toBe(true);
		expect(actions("sticky").closest('[aria-hidden="true"]')).not.toBeNull();

		await scroll(true);
		expect(actions("inline").hasAttribute("inert")).toBe(true);
		expect(actions("inline").getAttribute("aria-hidden")).toBe("true");
		expect(actions("sticky").hasAttribute("inert")).toBe(false);
		expect(actions("sticky").closest('[aria-hidden="true"]')).toBeNull();
		const compact = container.querySelector("[data-item-scroll-header]");
		expect(compact?.firstElementChild?.getAttribute("aria-hidden")).toBe(
			"true",
		);
		expect(container.querySelectorAll("h1")).toHaveLength(1);
		expect(action("sticky", 1).closest("form")).not.toBeNull();

		await scroll(false);
		expect(actions("inline").hasAttribute("inert")).toBe(false);
		expect(actions("sticky").hasAttribute("inert")).toBe(true);
	});

	it("keeps focus on the corresponding action in either scroll direction without scrolling", async () => {
		await render();
		const inlineSave = action("inline", 1);
		const stickySave = action("sticky", 1);
		const inlineFocus = vi.spyOn(inlineSave, "focus");
		const stickyFocus = vi.spyOn(stickySave, "focus");
		inlineSave.focus();
		await scroll(true);
		expect(document.activeElement).toBe(stickySave);
		expect(stickyFocus).toHaveBeenCalledWith({ preventScroll: true });
		await scroll(false);
		expect(document.activeElement).toBe(inlineSave);
		expect(inlineFocus).toHaveBeenLastCalledWith({ preventScroll: true });
	});

	it("does not move focus out of a field when the compact header appears", async () => {
		await render();
		const field = container.querySelector<HTMLInputElement>(
			'input[aria-label="Instructions"]',
		);
		field?.focus();
		await scroll(true);
		expect(document.activeElement).toBe(field);
	});

	it("preserves actions, native form submission, and disabled/loading state in both positions", async () => {
		await render();
		await act(async () => action("inline", 0).click());
		expect(onRun).toHaveBeenCalledTimes(1);
		await scroll(true);
		await act(async () => action("sticky", 0).click());
		expect(onRun).toHaveBeenCalledTimes(2);
		await act(async () => action("sticky", 1).click());
		expect(onSave).toHaveBeenCalledTimes(1);
		await render({ busy: true });
		for (const location of ["inline", "sticky"] as const) {
			expect(action(location, 0).disabled).toBe(true);
			expect(action(location, 1).disabled).toBe(true);
			expect(action(location, 1).textContent).toBe("Saving…");
			expect(action(location, 1).getAttribute("aria-busy")).toBe("true");
		}
		await act(async () => action("sticky", 1).click());
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it("updates scroll padding for wrapped actions and restores the viewport on unmount", async () => {
		await render();
		expect(
			container.style.getPropertyValue("--item-details-scroll-header-height"),
		).toBe("64px");
		headerHeight = 112;
		await act(async () => {
			for (const observer of ResizeObserverStub.instances)
				observer.callback([], observer as unknown as ResizeObserver);
		});
		expect(
			container.style.getPropertyValue("--item-details-scroll-header-height"),
		).toBe("112px");
		await act(async () => root.render(null));
		expect(
			container.style.getPropertyValue("--item-details-scroll-header-height"),
		).toBe("17px");
	});
});
