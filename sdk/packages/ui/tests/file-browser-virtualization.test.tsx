// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileBrowser } from "../components/file-browser.js";
import { FileBrowserTree } from "../components/file-browser-tree.js";

let container: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			return new DOMRect(
				0,
				0,
				600,
				this.matches("button[data-file-path]") ? 28 : 300,
			);
		},
	);
	style = document.createElement("style");
	style.textContent =
		".cline-ui-file-browser__navigation { row-gap: 2px; padding-top: 8px; }";
	document.head.append(style);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	style.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const path = (index: number) => `file-${String(index).padStart(5, "0")}.txt`;
const files = Array.from({ length: 10_000 }, (_, index) => ({
	path: path(index),
}));
async function render(node: ReactNode) {
	await act(async () => root.render(node));
}
function navigation() {
	const nav = container.querySelector("nav");
	if (!nav) throw new Error("Missing file navigation");
	return nav;
}
function buttons() {
	return [
		...navigation().querySelectorAll<HTMLButtonElement>(
			"button[data-file-path]",
		),
	];
}
function button(filePath: string) {
	const result = buttons().find(
		(element) => element.dataset.filePath === filePath,
	);
	if (!result) throw new Error(`Missing file button: ${filePath}`);
	return result;
}
async function scroll(index: number) {
	await act(async () => {
		navigation().scrollTop = index * 30 + 8;
		navigation().dispatchEvent(new Event("scroll"));
	});
}
async function focus(filePath: string) {
	await act(async () => button(filePath).focus());
}
async function tab(shiftKey = false) {
	const event = new KeyboardEvent("keydown", {
		key: "Tab",
		shiftKey,
		bubbles: true,
		cancelable: true,
	});
	await act(async () => document.activeElement?.dispatchEvent(event));
	return event;
}

describe("large file navigation", () => {
	it("keeps a bounded DOM while scrolling to and selecting the last of 10,000 files", async () => {
		const onSelect = vi.fn();
		await render(<FileBrowser files={files} onSelect={onSelect} />);
		expect(buttons().length).toBeLessThan(50);
		expect(buttons().map((element) => element.dataset.filePath)).toContain(
			path(0),
		);
		await scroll(5000);
		expect(button(path(5000))).toBeDefined();
		expect(buttons().length).toBeLessThan(50);
		expect(
			buttons().some((element) => element.dataset.filePath === path(1)),
		).toBe(false);
		expect(buttons()[0]).toBe(button(path(0)));
		expect(buttons().at(-1)).toBe(button(path(9999)));
		await scroll(9999);
		const last = button(path(9999));
		expect(last.type).toBe("button");
		expect(last.parentElement?.getAttribute("aria-posinset")).toBe("10000");
		expect(last.parentElement?.getAttribute("aria-setsize")).toBe("10000");
		await act(async () => last.click());
		expect(onSelect).toHaveBeenCalledExactlyOnceWith(path(9999));
		expect(navigation().querySelectorAll("*").length).toBeLessThan(400);
	});

	it("retains ancestor lists and original sibling positions for a window inside a nested folder", async () => {
		const nested = files
			.slice(0, 1000)
			.map((file) => ({ path: `folder/nested/${file.path}` }));
		await render(
			<FileBrowser
				files={[...nested, { path: "other.md" }]}
				onSelect={() => {}}
			/>,
		);
		await scroll(500);
		const file = button(`folder/nested/${path(500)}`);
		const parent = file.parentElement?.parentElement?.parentElement;
		expect(
			parent?.querySelector(":scope > button")?.getAttribute("data-file-path"),
		).toBe("folder/nested");
		expect(
			parent?.parentElement?.parentElement
				?.querySelector(":scope > button")
				?.getAttribute("data-file-path"),
		).toBe("folder");
		expect(file.parentElement?.getAttribute("aria-posinset")).toBe("501");
		expect(file.parentElement?.getAttribute("aria-setsize")).toBe("1000");
		expect(buttons().length).toBeLessThan(50);
	});

	it("moves Tab and Shift+Tab across unmounted window boundaries and leaves at the real ends", async () => {
		await render(<FileBrowser files={files} onSelect={() => {}} />);
		await focus(path(0));
		expect((await tab(true)).defaultPrevented).toBe(false);
		const boundary = buttons().at(-2)?.dataset.filePath;
		if (!boundary) throw new Error("Missing window boundary");
		const index = Number(boundary.slice(5, 10));
		await focus(boundary);
		expect((await tab()).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(button(path(index + 1)));
		await scroll(5000);
		const first = buttons().find(
			(element) =>
				element.dataset.filePath !== path(0) &&
				element.dataset.filePath !== path(index + 1),
		);
		if (!first?.dataset.filePath) throw new Error("Missing later window");
		const previous = Number(first.dataset.filePath.slice(5, 10)) - 1;
		await focus(first.dataset.filePath);
		expect((await tab(true)).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(button(path(previous)));
		await scroll(9999);
		await focus(path(9999));
		expect((await tab()).defaultPrevented).toBe(false);
	});

	it("pins focus during scrolling and follows its logical neighbor instead of jumping to the viewport", async () => {
		await render(
			<>
				<button type="button">Outside</button>
				<FileBrowser files={files} onSelect={() => {}} />
			</>,
		);
		await focus(path(1));
		const original = document.activeElement;
		await scroll(5000);
		expect(document.activeElement).toBe(original);
		expect(original?.isConnected).toBe(true);
		expect(buttons().length).toBeLessThan(50);
		await tab();
		expect(document.activeElement).toBe(button(path(2)));
		expect(navigation().scrollTop).toBeLessThan(300);
		await scroll(5000);
		const outside =
			container.querySelector<HTMLButtonElement>(":scope > button");
		await act(async () => outside?.focus());
		expect(
			buttons().some((element) => element.dataset.filePath === path(2)),
		).toBe(false);
		await render(
			<>
				<button type="button">Outside</button>
				<FileBrowser files={files.slice(3)} onSelect={() => {}} />
			</>,
		);
		expect(document.activeElement).toBe(outside);
	});

	it("restores focus to a surviving ancestor when a focused descendant is collapsed or deleted", async () => {
		const nested = files
			.slice(0, 1000)
			.map((file) => ({ path: `folder/${file.path}` }));
		const view = (items: typeof nested) => (
			<FileBrowser files={items} onSelect={() => {}} />
		);
		await render(view(nested));
		await scroll(500);
		await focus(`folder/${path(500)}`);
		await act(async () => button("folder").click());
		expect(document.activeElement).toBe(button("folder"));
		expect(button("folder").getAttribute("aria-expanded")).toBe("false");
		await act(async () => button("folder").click());
		await scroll(500);
		await focus(`folder/${path(500)}`);
		await render(
			view(nested.filter((file) => file.path !== `folder/${path(500)}`)),
		);
		expect(document.activeElement).toBe(button("folder"));
		expect(button("folder").getAttribute("aria-expanded")).toBe("true");
	});

	it("restores the latest adjacent row after earlier files are inserted and the focused file is removed", async () => {
		const view = (items: typeof files) => (
			<FileBrowser files={items} onSelect={() => {}} />
		);
		await render(view(files));
		await scroll(500);
		await focus(path(500));
		const inserted = [
			...Array.from({ length: 50 }, (_, index) => ({
				path: `before-${index}.txt`,
			})),
			...files,
		];
		await render(view(inserted));
		expect(document.activeElement).toBe(button(path(500)));
		await render(view(inserted.filter((file) => file.path !== path(500))));
		expect(document.activeElement).toBe(button(path(501)));
	});

	it("releases focus ownership when all rows disappear before new results arrive", async () => {
		const view = (items: typeof files) => (
			<>
				<button type="button">Outside</button>
				<FileBrowserTree
					files={items}
					label="Files"
					id="files"
					onSelect={() => {}}
				/>
			</>
		);
		await render(view(files));
		await focus(path(0));
		await render(view([]));
		const outside =
			container.querySelector<HTMLButtonElement>(":scope > button");
		await act(async () => outside?.focus());
		await render(view(files.slice(1)));
		expect(document.activeElement).toBe(outside);
	});

	it("commits measured row heights before revealing an initial selection near the end", async () => {
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				return new DOMRect(
					0,
					0,
					600,
					this.matches("button[data-file-path]") ? 48 : 300,
				);
			},
		);
		const setScrollTop = Object.getOwnPropertyDescriptor(
			Element.prototype,
			"scrollTop",
		)?.set;
		if (!setScrollTop) throw new Error("Missing native scrollTop setter");
		vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(
			function (this: Element, value: number) {
				const spacer = this.firstElementChild as HTMLElement | null;
				const max = Math.max(
					0,
					Number.parseFloat(spacer?.style.height ?? "0") - 300 + 16,
				);
				setScrollTop.call(this, Math.min(max, Math.max(0, value)));
			},
		);
		await render(
			<FileBrowser
				files={files}
				selectedPath={path(9000)}
				onSelect={() => {}}
			/>,
		);
		expect(button(path(9000)).getAttribute("aria-current")).toBe("page");
		expect(navigation().scrollTop).toBeGreaterThan(449_000);
	});

	it("reveals an externally selected file without taking keyboard focus", async () => {
		const onSelect = vi.fn();
		const view = (selectedPath: string) => (
			<>
				<button type="button">Outside</button>
				<FileBrowser
					files={files}
					selectedPath={selectedPath}
					onSelect={onSelect}
				/>
			</>
		);
		await render(view(path(9000)));
		expect(button(path(9000)).getAttribute("aria-current")).toBe("page");
		expect(navigation().scrollTop).toBeGreaterThan(200_000);
		const outside =
			container.querySelector<HTMLButtonElement>(":scope > button");
		await act(async () => outside?.focus());
		await render(view(path(1000)));
		expect(button(path(1000)).getAttribute("aria-current")).toBe("page");
		expect(document.activeElement).toBe(outside);
		expect(onSelect).not.toHaveBeenCalled();
	});
});
