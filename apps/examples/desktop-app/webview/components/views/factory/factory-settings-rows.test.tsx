// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ActionButton,
	DisclosureRow,
	GroupHeading,
	GroupHeadingRow,
	SettingRow,
} from "./factory-settings-rows";

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

const render = (node: ReactNode) => act(async () => root.render(node));

describe("settings row primitives", () => {
	it("draws group headings as uppercase section labels with no hover", async () => {
		await render(
			<>
				<GroupHeading hint="hint">Limits</GroupHeading>
				<GroupHeadingRow
					title="Stages"
					hint="hint"
					action={<button type="button">Add</button>}
				/>
			</>,
		);
		for (const heading of Array.from(container.querySelectorAll("h3"))) {
			expect(heading.className).toContain("uppercase");
			expect(heading.className).toContain("select-none");
			expect(heading.className).not.toMatch(/hover:|cursor-pointer/);
			expect(heading.getAttribute("tabindex")).toBeNull();
			expect(heading.querySelector("span")?.className).toContain("normal-case");
		}
	});

	it("makes a row's title the label of its control when asked", async () => {
		await render(
			<SettingRow id="auto" title="Start on its own" labelFor="auto-switch">
				<input id="auto-switch" type="checkbox" />
			</SettingRow>,
		);
		const title = container.querySelector("#auto-title");
		expect(title?.tagName).toBe("LABEL");
		expect(title?.getAttribute("for")).toBe("auto-switch");
	});

	it("turns one down chevron when a disclosure row opens", async () => {
		await render(
			<DisclosureRow id="details" title="Details">
				<p>Inside</p>
			</DisclosureRow>,
		);
		const button = container.querySelector("button");
		const icon = () => button?.querySelectorAll("svg") ?? [];
		expect(icon()).toHaveLength(1);
		expect(icon()[0]?.getAttribute("class")).toContain("lucide-chevron-down");
		expect(icon()[0]?.getAttribute("class")).not.toContain("rotate-180");
		await act(async () => button?.click());
		expect(button?.getAttribute("aria-expanded")).toBe("true");
		expect(icon()[0]?.getAttribute("class")).toContain("rotate-180");
	});

	it("draws a danger action with red text and a red border only on hover", async () => {
		await render(
			<ActionButton danger onClick={vi.fn()}>
				Remove project…
			</ActionButton>,
		);
		const classes = container.querySelector("button")?.className.split(" ");
		expect(classes).toContain("text-error-text");
		expect(classes).toContain("hover:border-destructive/60");
		expect(classes).not.toContain("border-destructive/60");
	});

	it("puts the browser arrow after an outside action's label", async () => {
		await render(
			<ActionButton icon="outside" onClick={vi.fn()}>
				Open docs
			</ActionButton>,
		);
		const button = container.querySelector("button");
		expect(button?.lastElementChild?.getAttribute("class")).toContain(
			"lucide-arrow-up-right",
		);
	});
});
