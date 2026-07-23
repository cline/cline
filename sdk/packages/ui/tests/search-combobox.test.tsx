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
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		fireEvent.click(trigger);
		const popup = screen.getByRole("dialog");
		const listbox = screen.getByRole("listbox");
		expect(listbox).toBeTruthy();
		expect(listbox.closest(".cline-ui-theme")).toBeTruthy();
		const search = screen.getByRole("combobox", {
			name: "Search repository",
		});
		expect(trigger.getAttribute("aria-controls")).toBe(popup.id);
		expect(search.getAttribute("aria-controls")).toBe(listbox.id);
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

	it("filters only on visible option text", () => {
		render(
			<SearchCombobox
				ariaLabel="Repository"
				emptyText="No matching repositories."
				onValueChange={vi.fn()}
				options={[
					{
						description: "Primary codebase",
						label: "cline/cline",
						value: "https://github.com/cline/cline",
					},
					{
						description: "Cloud dashboard",
						label: "cline/core-platform",
						value: "https://github.com/cline/core-platform",
					},
				]}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Repository: Select an option…",
			}),
		);
		const search = screen.getByRole("combobox", {
			name: "Search repository",
		});
		fireEvent.change(search, { target: { value: "dashboard" } });
		expect(screen.queryByText("cline/cline")).toBeNull();
		expect(screen.getByText("cline/core-platform")).toBeTruthy();

		fireEvent.change(search, { target: { value: "https" } });
		expect(screen.queryByRole("option")).toBeNull();
		expect(screen.getByRole("status").textContent).toBe(
			"No matching repositories.",
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

	it("stays open and preserves the search while options load", () => {
		const props = {
			ariaLabel: "Repository",
			onValueChange: vi.fn(),
			options: [{ label: "cline/cline", value: "cline/cline" }],
		};
		const { rerender } = render(<SearchCombobox {...props} />);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Repository: Select an option…",
			}),
		);
		const search = screen.getByRole("combobox", {
			name: "Search repository",
		}) as HTMLInputElement;
		fireEvent.change(search, { target: { value: "cli" } });

		rerender(
			<SearchCombobox {...props} loading loadingText="Loading repositories…" />,
		);

		expect(screen.getByRole("listbox")).toBeTruthy();
		expect(search.value).toBe("cli");
		expect(screen.getByRole("status").textContent).toBe(
			"Loading repositories…",
		);
	});

	it("portals into the nearest scoped dark theme boundary by default", () => {
		const themeRoot = document.createElement("div");
		themeRoot.className = "cline-ui-theme dark";
		document.body.append(themeRoot);
		render(
			<SearchCombobox
				ariaLabel="Repository"
				onValueChange={vi.fn()}
				options={[{ label: "cline/cline", value: "cline/cline" }]}
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
