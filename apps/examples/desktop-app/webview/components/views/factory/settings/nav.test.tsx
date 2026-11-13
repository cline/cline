// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsNav, SettingsPageMenu } from "./nav";
import { SETTINGS_PAGES } from "./registry";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function render(element: ReactElement) {
	await act(async () => root.render(element));
}
const classes = (element: Element | null | undefined) =>
	new Set(element?.getAttribute("class")?.split(/\s+/));
const item = (page: string) =>
	container.querySelector(`[data-settings-page="${page}"]`);
const props = {
	pages: SETTINGS_PAGES,
	current: "limits" as const,
	badges: {},
	onOpen: vi.fn(),
};

function expectSectionAndItemTreatment(labels: Element[]) {
	expect(labels).toHaveLength(5);
	for (const label of labels) {
		expect(classes(label).has("uppercase")).toBe(true);
		expect(label.closest("button, a")).toBeNull();
		expect(label.hasAttribute("tabindex")).toBe(false);
		expect(label.querySelector("svg")).toBeNull();
	}
	const items = [...container.querySelectorAll("[data-settings-page]")];
	expect(items).toHaveLength(11);
	for (const element of items) {
		expect(element.querySelector("svg")).not.toBeNull();
		expect(classes(element).has("uppercase")).toBe(false);
	}
	// Only the current page is selected; a hovered page gets the lighter fill.
	const current = classes(item("limits"));
	const other = classes(item("roles"));
	expect(current.has("bg-surface-hover")).toBe(true);
	expect(current.has("before:bg-primary")).toBe(true);
	expect(current.has("font-medium")).toBe(true);
	expect(other.has("bg-surface-hover")).toBe(false);
	expect(other.has("before:bg-primary")).toBe(false);
	expect(other.has("hover:bg-surface-hover-lighter")).toBe(true);
	expect(current.has("hover:bg-surface-hover-lighter")).toBe(false);
}

describe("settings section list", () => {
	it("draws group labels as static headers and marks only the current page", async () => {
		await render(<SettingsNav {...props} />);
		expectSectionAndItemTreatment([...container.querySelectorAll("nav h3")]);
	});

	it("gives the folded menu the same labels and selection", async () => {
		await render(<SettingsPageMenu {...props} />);
		await act(async () =>
			container
				.querySelector<HTMLElement>("[data-settings-page-menu]")
				?.click(),
		);
		expectSectionAndItemTreatment([
			...container.querySelectorAll('[role="group"] > p'),
		]);
	});

	it("highlights one search result whether it was reached by arrows or the pointer", async () => {
		await render(<SettingsNav {...props} />);
		const search = container.querySelector<HTMLInputElement>(
			'input[type="search"]',
		);
		if (!search) throw new Error("No search field");
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(search, "approve");
			search.dispatchEvent(new Event("input", { bubbles: true }));
		});
		const arrowDown = () =>
			search.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
			);
		await act(async () => arrowDown());
		await act(async () => arrowDown());
		const hits = [...container.querySelectorAll('[role="option"]')];
		expect(hits.length).toBeGreaterThan(3);
		const highlighted = () =>
			hits.filter(
				(hit) =>
					hit.getAttribute("aria-selected") === "true" &&
					classes(hit).has("bg-surface-hover"),
			);
		expect(highlighted()).toEqual([hits[2]]);
		await act(async () =>
			hits[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
		);
		expect(highlighted()).toEqual([hits[0]]);
		expect(
			hits.filter((hit) => classes(hit).has("bg-surface-hover")),
		).toHaveLength(1);
	});
});
