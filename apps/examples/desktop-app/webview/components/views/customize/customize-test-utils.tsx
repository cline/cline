import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { CustomizePage } from "./customize-page";
import type { CustomizeSection } from "./customize-sections";
import type { CustomizeTab } from "./navigation/customize-categories";

/** A mounted DOM root with the browser observers these page tests require. */
export function createCustomizeTestRoot() {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	class ObserverStub {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", ObserverStub);
	vi.stubGlobal("IntersectionObserver", ObserverStub);
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	return {
		container,
		root,
		async cleanup() {
			await act(async () => root.unmount());
			container.remove();
			vi.unstubAllGlobals();
		},
	};
}

export function findButton(within: ParentNode, label: string) {
	const result = [...within.querySelectorAll<HTMLButtonElement>("button")].find(
		(candidate) =>
			!candidate.closest("[hidden]") &&
			(candidate.getAttribute("aria-label") === label ||
				candidate.textContent?.trim() === label),
	);
	if (!result) throw new Error(`Missing button: ${label}`);
	return result;
}

export async function setInputValue(input: HTMLInputElement, value: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

/** Own Browse/Manage and category state without replacing the page under test. */
export function CustomizeTestHarness({
	initialSection = "manage",
	initialCategory = "all",
	onOpenModelProviders = () => {},
}: {
	initialSection?: CustomizeSection;
	initialCategory?: CustomizeTab;
	onOpenModelProviders?: () => void;
}) {
	const [section, setSection] = useState(initialSection);
	const [category, setCategory] = useState(initialCategory);
	return (
		<>
			<output data-testid="shared-category">{category}</output>
			<CustomizePage
				section={section}
				customizeCategory={category}
				onCustomizeCategoryChange={setCategory}
				onNavigateSection={setSection}
				onOpenModelProviders={onOpenModelProviders}
			/>
		</>
	);
}
