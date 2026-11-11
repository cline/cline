// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	browseFilterToCustomizeTab,
	customizeTabToBrowseFilter,
} from "./customize-categories";
import { CustomizeCategoryBar } from "./customize-category-bar";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

function pills() {
	return [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

describe("Customize category navigation", () => {
	it("keeps the selected category when switching between Browse and Manage", async () => {
		const onValueChange = vi.fn();
		const render = async (mode: "browse" | "manage") => {
			await act(async () =>
				root.render(
					<CustomizeCategoryBar
						mode={mode}
						value="skills"
						onValueChange={onValueChange}
						connectorsAvailable
					/>,
				),
			);
		};
		await render("browse");
		expect(pills().map((pill) => pill.dataset.customizeCategory)).toEqual([
			"all",
			"connectors",
			"plugins",
			"skills",
			"mcp",
		]);
		expect(container.querySelector('[aria-checked="true"]')?.textContent).toBe(
			"Skills",
		);
		await render("manage");
		expect(pills().map((pill) => pill.dataset.customizeCategory)).toEqual([
			"all",
			"connectors",
			"plugins",
			"skills",
			"mcp",
			"tools",
			"rules",
			"hooks",
		]);
		const selected = container.querySelector<HTMLButtonElement>(
			'[aria-checked="true"]',
		)!;
		expect(selected.textContent).toBe("Skills");
		await act(async () => selected.click());
		expect(onValueChange).toHaveBeenLastCalledWith("all");
		const plugins = pills().find(
			(pill) => pill.dataset.customizeCategory === "plugins",
		)!;
		await act(async () => plugins.click());
		expect(onValueChange).toHaveBeenLastCalledWith("plugins");
	});

	it("omits unavailable Browse connectors while retaining Manage's configuration category", async () => {
		const ref = createRef<HTMLDivElement>();
		const render = async (
			mode: "browse" | "manage",
			connectorsAvailable = false,
		) => {
			await act(async () =>
				root.render(
					<CustomizeCategoryBar
						ref={ref}
						mode={mode}
						value="all"
						onValueChange={() => {}}
						connectorsAvailable={connectorsAvailable}
					/>,
				),
			);
		};
		await render("browse");
		expect(pills().map((pill) => pill.textContent)).toEqual([
			"All",
			"Plugins",
			"Skills",
			"MCP",
		]);
		await render("browse", true);
		expect(pills()[1].textContent).toBe("ConnectorsBeta");
		expect(
			ref.current?.contains(
				container.querySelector('[aria-label="Browse categories"]'),
			),
		).toBe(true);
		await render("manage");
		expect(pills()[1].textContent).toBe("ConnectorsBeta");
		expect(
			pills().find((pill) => pill.dataset.customizeCategory === "plugins")
				?.textContent,
		).toBe("Plugins");
	});

	it("maps shared categories both ways and distinguishes inventory-only selections", () => {
		for (const filter of [
			null,
			"connector",
			"plugin",
			"skill",
			"mcp",
		] as const) {
			expect(
				customizeTabToBrowseFilter(browseFilterToCustomizeTab(filter)),
			).toBe(filter);
		}
		for (const category of ["tools", "rules", "hooks"] as const) {
			expect(customizeTabToBrowseFilter(category)).toBeUndefined();
		}
	});
});
