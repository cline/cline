// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchCombobox } from "../src/index.js";

class TestResizeObserver implements ResizeObserver {
	disconnect() {}
	observe() {}
	unobserve() {}
}

globalThis.ResizeObserver = TestResizeObserver;
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

describe("SearchCombobox", () => {
	it("selects a searchable option with a real listbox relationship", () => {
		const onValueChange = vi.fn();
		render(
			<SearchCombobox
				ariaLabel="Repository"
				onValueChange={onValueChange}
				options={[
					{ label: "cline/cline", value: "https://github.com/cline/cline" },
					{
						label: "cline/core-platform",
						value: "https://github.com/cline/core-platform",
					},
				]}
			/>,
		);

		const trigger = screen.getByRole("combobox", { name: "Repository" });
		expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
		fireEvent.click(trigger);
		const listbox = screen.getByRole("listbox");
		expect(trigger.getAttribute("aria-controls")).toBe(listbox.id);
		expect(listbox.closest(".cline-ui-theme")).toBeTruthy();

		const search = document.querySelector(
			".cline-ui-combobox__search",
		) as HTMLInputElement | null;
		if (!search) throw new Error("Search input was not rendered");
		fireEvent.change(search, { target: { value: "core-platform" } });
		fireEvent.click(screen.getByText("cline/core-platform"));
		expect(onValueChange).toHaveBeenCalledWith(
			"https://github.com/cline/core-platform",
		);

		fireEvent.click(trigger);
		expect(document.querySelector(".cline-ui-combobox__search")).toHaveProperty(
			"value",
			"",
		);
	});

	it("closes when it becomes unavailable", () => {
		const onValueChange = vi.fn();
		const { rerender } = render(
			<SearchCombobox
				ariaLabel="Repository"
				onValueChange={onValueChange}
				options={[{ label: "cline/cline", value: "cline/cline" }]}
			/>,
		);

		fireEvent.click(screen.getByRole("combobox", { name: "Repository" }));
		expect(screen.getByRole("listbox")).toBeTruthy();

		rerender(
			<SearchCombobox
				ariaLabel="Repository"
				disabled
				onValueChange={onValueChange}
				options={[{ label: "cline/cline", value: "cline/cline" }]}
			/>,
		);

		expect(screen.queryByRole("listbox")).toBeNull();
		expect(
			screen.getByRole("combobox", { name: "Repository" }).hasAttribute("disabled"),
		).toBe(true);
		expect(onValueChange).not.toHaveBeenCalled();
	});
});
