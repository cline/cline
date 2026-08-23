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
		// Selecting by click must hand focus back to the trigger, not <body>.
		expect(document.activeElement).toBe(trigger);
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

	it("navigates with arrow keys and selects with Enter", async () => {
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

		await act(async () => container.querySelector("button")?.click());
		const search = container.querySelector("input");
		// Opens with the selected option active; ArrowDown moves to the next.
		expect(search?.getAttribute("aria-activedescendant")).toContain(
			"-option-0",
		);
		await act(async () => {
			search?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
			);
		});
		expect(search?.getAttribute("aria-activedescendant")).toContain(
			"-option-1",
		);
		const active = container.querySelector('[data-active="true"]');
		expect(active?.textContent).toContain("cline/core-platform");
		await act(async () => {
			search?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
			);
		});
		expect(onValueChange).toHaveBeenCalledWith("core-platform");
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		// Selecting by Enter must hand focus back to the trigger, not <body>.
		expect(document.activeElement).toBe(container.querySelector("button"));
	});

	it("closes the popup when Tab moves focus out of the component", async () => {
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
		expect(container.querySelector('[role="dialog"]')).not.toBeNull();

		const search = container.querySelector("input");
		await act(async () => {
			search?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
			);
		});

		expect(container.querySelector('[role="dialog"]')).toBeNull();
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");
		expect(onValueChange).not.toHaveBeenCalled();
	});

	it("renders section headers and badges, and flattens while searching", async () => {
		const sectionedOptions = [
			{
				badge: "NEW",
				label: "Claude Opus 5",
				section: "recommended",
				value: "anthropic/claude-opus-5",
			},
			{
				label: "DeepSeek V4 Flash",
				section: "free",
				value: "deepseek/deepseek-v4-flash",
			},
			{ label: "Everything Else", section: "all", value: "misc/other" },
		];
		await act(async () =>
			root.render(
				<SearchCombobox
					ariaLabel="Model"
					onValueChange={() => {}}
					options={sectionedOptions}
					sections={[
						{ id: "recommended", label: "Recommended" },
						{ description: "No cost", id: "free", label: "Free" },
						{ id: "all", label: "All models" },
					]}
					value="anthropic/claude-opus-5"
				/>,
			),
		);

		await act(async () => container.querySelector("button")?.click());
		const panel = container.querySelector('[role="dialog"]');
		expect(panel?.textContent).toContain("Recommended");
		expect(panel?.textContent).toContain("Free");
		expect(panel?.textContent).toContain("No cost");
		expect(panel?.textContent).toContain("All models");
		expect(
			panel?.querySelector(".cline-ui-search-combobox__badge")?.textContent,
		).toBe("NEW");

		const search = container.querySelector("input");
		await act(async () => {
			const setValue = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setValue?.call(search, "deepseek");
			search?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		const searchedPanel = container.querySelector('[role="dialog"]');
		expect(searchedPanel?.textContent).not.toContain("Recommended");
		expect(searchedPanel?.textContent).toContain("DeepSeek V4 Flash");
		// Options remain searchable by id, and label matches are highlighted.
		expect(
			searchedPanel?.querySelector(".cline-ui-search-combobox__match")
				?.textContent,
		).toBe("DeepSeek");
	});

	it("centers the selected option on open, then scrolls minimally", async () => {
		const scrollIntoView = vi.fn();
		HTMLElement.prototype.scrollIntoView = scrollIntoView;
		await act(async () =>
			root.render(
				<SearchCombobox
					ariaLabel="Repository"
					onValueChange={() => {}}
					options={options}
					value="core-platform"
				/>,
			),
		);

		await act(async () => container.querySelector("button")?.click());
		expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
		const centeredCalls = scrollIntoView.mock.calls.length;

		const search = container.querySelector("input");
		await act(async () => {
			search?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
			);
		});
		expect(scrollIntoView.mock.calls.length).toBeGreaterThan(centeredCalls);
		expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });

		// Mouse hover moves the active row but must never scroll the list:
		// scrolling under the cursor re-triggers hover and makes it jump.
		const keyboardCalls = scrollIntoView.mock.calls.length;
		const lastOption = [
			...container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
		].at(-1);
		await act(async () => {
			lastOption?.dispatchEvent(
				new MouseEvent("mousemove", { bubbles: true }),
			);
		});
		expect(lastOption?.dataset.active).toBe("true");
		expect(scrollIntoView.mock.calls.length).toBe(keyboardCalls);
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
