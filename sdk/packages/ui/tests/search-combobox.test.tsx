// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
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

		const trigger = screen.getByRole("button", {
			name: "Repository: Select an option…",
		});
		expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
		fireEvent.click(trigger);
		const listbox = screen.getByRole("listbox");
		expect(listbox).toBeTruthy();
		expect(listbox.closest(".cline-ui-theme")).toBeTruthy();
		const search = screen.getByRole("combobox", {
			name: "Search repository",
		});
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

	it("opens with the committed option active", () => {
		const onValueChange = vi.fn();
		render(
			<SearchCombobox
				ariaLabel="Repository"
				onValueChange={onValueChange}
				options={[
					{ label: "cline/cline", value: "cline/cline" },
					{ label: "cline/core-platform", value: "cline/core-platform" },
				]}
				value="cline/core-platform"
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Repository: cline/core-platform",
			}),
		);
		const selectedOption = screen.getByRole("option", {
			name: /cline\/core-platform/,
		});
		expect(selectedOption.getAttribute("aria-selected")).toBe("true");
		fireEvent.keyDown(
			screen.getByRole("combobox", { name: "Search repository" }),
			{ key: "Enter" },
		);
		expect(onValueChange).toHaveBeenCalledWith("cline/core-platform");
	});

	it("closes and restores focus when it becomes unavailable", async () => {
		const onValueChange = vi.fn();
		const { rerender } = render(
			<SearchCombobox
				ariaLabel="Repository"
				onValueChange={onValueChange}
				options={[{ label: "cline/cline", value: "cline/cline" }]}
			/>,
		);

		const trigger = screen.getByRole("button", {
			name: "Repository: Select an option…",
		});
		fireEvent.click(trigger);
		expect(screen.getByRole("listbox")).toBeTruthy();
		expect(document.activeElement).toBe(
			screen.getByRole("combobox", { name: "Search repository" }),
		);

		rerender(
			<SearchCombobox
				ariaLabel="Repository"
				disabled
				onValueChange={onValueChange}
				options={[{ label: "cline/cline", value: "cline/cline" }]}
			/>,
		);

		expect(screen.queryByRole("listbox")).toBeNull();
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(trigger.getAttribute("aria-disabled")).toBe("true");
		expect(onValueChange).not.toHaveBeenCalled();
	});

	it("can portal into a scoped dark theme boundary", () => {
		const themeRoot = document.createElement("div");
		themeRoot.className = "cline-ui-theme dark";
		document.body.append(themeRoot);
		render(
			<SearchCombobox
				ariaLabel="Repository"
				onValueChange={vi.fn()}
				options={[{ label: "cline/cline", value: "cline/cline" }]}
				portalContainer={themeRoot}
			/>,
			{ container: themeRoot },
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Repository: Select an option…",
			}),
		);
		expect(
			screen
				.getByRole("listbox")
				.closest(".cline-ui-combobox__popover")
				?.closest(".dark"),
		).toBe(themeRoot);
	});
});
