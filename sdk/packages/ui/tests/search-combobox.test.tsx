// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchCombobox } from "../components/index.js";

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
	vi.restoreAllMocks();
});

const options = [
	{ label: "cline/cline", value: "cline" },
	{
		description: "Cloud dashboard",
		label: "cline/core-platform",
		value: "core-platform",
	},
];

describe("SearchCombobox", () => {
	it("filters and selects an option", async () => {
		const onValueChange = vi.fn();
		await act(async () =>
			root.render(
				<SearchCombobox
					ariaLabel="Repository"
					onValueChange={onValueChange}
					options={options}
					value="cline"
				/>,
			),
		);

		const trigger = container.querySelector("button");
		expect(trigger?.getAttribute("aria-label")).toBe("Repository: cline/cline");
		await act(async () => trigger?.click());
		const search = container.querySelector("input");
		await act(async () => {
			const setValue = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setValue?.call(search, "dashboard");
			search?.dispatchEvent(new Event("input", { bubbles: true }));
		});

		const panel = container.querySelector('[role="dialog"]');
		expect(panel?.textContent).not.toContain("cline/cline");
		const match = Array.from(panel?.querySelectorAll("button") ?? []).find(
			(button) => button.textContent === "cline/core-platformCloud dashboard",
		);
		await act(async () => match?.click());

		expect(onValueChange).toHaveBeenCalledWith("core-platform");
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");
	});

	it("closes on Escape and returns focus to the trigger", async () => {
		const onValueChange = vi.fn();
		await act(async () =>
			root.render(
				<SearchCombobox
					ariaLabel="Repository"
					onValueChange={onValueChange}
					options={options}
					value="cline"
				/>,
			),
		);

		const trigger = container.querySelector("button");
		await act(async () => trigger?.click());
		const panel = container.querySelector('[role="dialog"]');
		expect(panel).not.toBeNull();

		const search = container.querySelector("input");
		await act(async () => {
			search?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			);
		});

		expect(container.querySelector('[role="dialog"]')).toBeNull();
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");
		expect(document.activeElement).toBe(trigger);
		expect(onValueChange).not.toHaveBeenCalled();
	});

	it("renders loading and disabled states", async () => {
		const onValueChange = vi.fn();
		const render = (disabled = false, loading = false) =>
			root.render(
				<SearchCombobox
					ariaLabel="Model"
					disabled={disabled}
					loading={loading}
					loadingText="Loading models…"
					onValueChange={onValueChange}
					options={options}
				/>,
			);

		await act(async () => render());
		await act(async () => container.querySelector("button")?.click());
		await act(async () => render(true));
		const optionButtons = container.querySelectorAll<HTMLButtonElement>(
			".cline-ui-search-combobox__option",
		);
		expect(optionButtons[1]?.disabled).toBe(true);
		await act(async () => optionButtons[1]?.click());
		expect(onValueChange).not.toHaveBeenCalled();

		await act(async () => render(true, true));
		expect(container.textContent).toContain("Loading models…");
		expect(container.querySelector("button")?.disabled).toBe(true);
	});
});
