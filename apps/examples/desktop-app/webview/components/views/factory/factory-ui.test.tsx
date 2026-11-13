// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DetailsSummary,
	FactoryIdChip,
	NAV_ITEM,
	NAV_ITEM_SELECTED,
	StatusPill,
	toneStatusText,
} from "./factory-ui";

let container: HTMLDivElement;
let root: Root;
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

const classes = (value: string) => value.split(" ");

describe("affordance primitives", () => {
	it("marks a selected navigation item more strongly than a hovered one", () => {
		const hover = classes(NAV_ITEM).filter((item) =>
			item.startsWith("hover:bg-"),
		);
		expect(hover).toEqual(["hover:bg-surface-hover-lighter"]);
		expect(classes(NAV_ITEM_SELECTED)).toEqual(
			expect.arrayContaining([
				"bg-surface-hover",
				"font-medium",
				"before:bg-primary",
			]),
		);
		expect(NAV_ITEM_SELECTED).not.toContain("surface-hover-lighter");
	});

	it("draws a status pill as a borderless tint that is not a button", async () => {
		await act(async () =>
			root.render(<StatusPill tone="attention">In use</StatusPill>),
		);
		const pill = container.firstElementChild as HTMLElement;
		expect(pill.tagName).not.toBe("BUTTON");
		expect(pill.getAttribute("role")).toBeNull();
		expect(classes(pill.className)).toEqual(
			expect.arrayContaining([
				"rounded-full",
				"border-transparent",
				"bg-amber-500/15",
				"text-warning-text",
			]),
		);
		expect(pill.className).not.toMatch(/border-amber/);
	});

	it("shows a card id without a box", async () => {
		await act(async () =>
			root.render(<FactoryIdChip task={{ factoryNumber: 42 }} />),
		);
		const chip = container.querySelector("[data-factory-id]");
		expect(chip?.textContent).toBe("F42");
		expect(chip?.className).not.toMatch(/\b(border|rounded)\b/);
	});

	it("keeps violet for links: accent status text is plain foreground", () => {
		expect(toneStatusText("accent")).toBe("text-foreground");
		expect(toneStatusText("danger")).toBe("text-error-text");
	});

	it("turns a summary's chevron for its own details only", async () => {
		await act(async () =>
			root.render(
				<details open>
					<DetailsSummary>Outer</DetailsSummary>
					<details>
						<DetailsSummary>How to</DetailsSummary>
						<p>Steps</p>
					</details>
				</details>,
			),
		);
		const turned = container.querySelectorAll("details[open] > summary > svg");
		expect(turned).toHaveLength(1);
		expect(turned[0]?.parentElement?.textContent).toBe("Outer");
		for (const svg of container.querySelectorAll("summary > svg"))
			expect(svg.getAttribute("class")).toContain(
				"[details[open]>summary>&]:rotate-180",
			);
		expect(container.querySelector("summary")?.className).toContain(
			"list-none",
		);
	});
});
