// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomizationTopic } from "../navigation/customize-category-filter";

const mocks = vi.hoisted(() => ({ filter: vi.fn() }));
vi.mock("../navigation/customize-category-filter", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../navigation/customize-category-filter")
	>()),
	useCustomizeCategoryFilter: mocks.filter,
}));

import {
	CustomizationCategoryNavigationProvider,
	CustomizationCategorySection,
} from "./customization-category-section";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	mocks.filter.mockReset();
	mocks.filter.mockReturnValue(null);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

describe("Customization detail categories", () => {
	it("normalizes connector labels to catalog categories and navigates before closing", async () => {
		const category: CustomizationTopic = {
			id: "developer-tools",
			label: "Developer Tools",
		};
		const setCategory = vi.fn();
		const onSelectCategory = vi.fn();
		const onSelected = vi.fn();
		mocks.filter.mockReturnValue({
			categories: [category],
			setCategory,
		});
		await act(async () =>
			root.render(
				<CustomizationCategoryNavigationProvider
					onSelectCategory={onSelectCategory}
				>
					<CustomizationCategorySection
						categories={[
							"developer_tools",
							"Developer Tools",
							"developer-tools",
						]}
						onSelected={onSelected}
					/>
				</CustomizationCategoryNavigationProvider>,
			),
		);
		const button = container.querySelector<HTMLButtonElement>("button");
		expect(container.querySelectorAll("button")).toHaveLength(1);
		expect(container.querySelector("section h2")?.textContent).toBe("Category");
		expect(button?.textContent).toBe("Developer Tools");
		expect(button?.title).toBe("Filter by Developer Tools");
		expect(button?.getAttribute("data-slot")).toBe("badge");
		await act(async () => button?.click());
		expect(onSelectCategory).toHaveBeenCalledExactlyOnceWith(category);
		expect(setCategory).not.toHaveBeenCalled();
		expect(onSelected).toHaveBeenCalledExactlyOnceWith();
		expect(onSelectCategory.mock.invocationCallOrder[0]).toBeLessThan(
			onSelected.mock.invocationCallOrder[0],
		);
	});

	it("preserves explicit raw-value callbacks and falls back to supplied labels", async () => {
		const navigate = vi.fn();
		const onSelectCategory = vi.fn();
		await act(async () =>
			root.render(
				<CustomizationCategoryNavigationProvider onSelectCategory={navigate}>
					<CustomizationCategorySection
						categories={["development"]}
						tagLabels={new Map([["development", "Development"]])}
						onSelectCategory={onSelectCategory}
					/>
				</CustomizationCategoryNavigationProvider>,
			),
		);
		const button = container.querySelector<HTMLButtonElement>("button");
		expect(button?.textContent).toBe("Development");
		await act(async () => button?.click());
		expect(onSelectCategory).toHaveBeenCalledExactlyOnceWith("development");
		expect(navigate).not.toHaveBeenCalled();
	});

	it("uses the shared filter without a navigation host and disables unavailable actions", async () => {
		const setCategory = vi.fn();
		mocks.filter.mockReturnValue({ categories: [], setCategory });
		const render = () => (
			<CustomizationCategorySection categories={["Productivity"]} />
		);
		await act(async () => root.render(render()));
		await act(async () => container.querySelector("button")?.click());
		expect(setCategory).toHaveBeenCalledExactlyOnceWith({
			id: "Productivity",
			label: "Productivity",
		});
		mocks.filter.mockReturnValue(null);
		await act(async () => root.render(render()));
		expect(container.querySelector("button")?.disabled).toBe(true);
		expect(container.querySelector("button")?.getAttribute("data-slot")).toBe(
			"badge",
		);
	});
});
