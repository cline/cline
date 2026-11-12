// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailPage } from "./detail-page";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

function element(selector: string) {
	const match = container.querySelector<HTMLElement>(selector);
	if (!match) throw new Error(`Missing ${selector}`);
	return match;
}

describe("DetailPage window drag area", () => {
	it.each([
		{ page: "Customize", title: "Customize", backLabel: "Manage" },
		{ page: "Schedule", title: undefined, backLabel: "Schedule" },
	])("keeps the $page title-bar and navigation structurally separate", async ({
		title,
		backLabel,
	}) => {
		const onBack = vi.fn();
		await act(async () =>
			root.render(
				<DetailPage title={title} backLabel={backLabel} onBack={onBack}>
					<p data-testid="detail-content">Selectable detail content</p>
				</DetailPage>,
			),
		);

		const dragArea = element("[data-detail-navigation]");
		const navigation = element("nav");
		const titleBar = element("[data-page-title-bar]");
		const viewport = element('[data-slot="scroll-area-viewport"]');
		const back = element(`button[aria-label="Back to ${backLabel}"]`);
		const content = element('[data-testid="detail-content"]');
		expect(dragArea.getAttribute("data-tauri-drag-region")).toBe("deep");
		expect(titleBar.getAttribute("data-tauri-drag-region")).toBe("deep");
		expect(navigation.getAttribute("aria-label")).toBe("Detail navigation");
		expect(viewport.contains(titleBar)).toBe(true);
		expect(titleBar.contains(back)).toBe(false);
		expect(viewport.contains(content)).toBe(true);
		expect(viewport.contains(back)).toBe(true);
		expect(content.closest("[data-tauri-drag-region]")).toBeNull();
		// Tauri's deep region exempts buttons unless they explicitly opt in.
		expect(back.hasAttribute("data-tauri-drag-region")).toBe(false);
		const heading = container.querySelector("h1");
		expect(heading?.textContent).toBe(title);
		expect(heading?.closest("nav") ?? null).toBeNull();
		expect(document.activeElement).toBe(back);

		await act(async () => back.click());
		expect(onBack).toHaveBeenCalledOnce();
	});

	it.each([
		{ title: "Customize", target: "h1" },
		{ title: undefined, target: "[data-detail-content]" },
	])("uses $target as the focus fallback when Back is disabled", async ({
		title,
		target,
	}) => {
		await act(async () =>
			root.render(
				<DetailPage
					key={target}
					title={title}
					backLabel="Manage"
					backDisabled
					onBack={() => {}}
				>
					Content
				</DetailPage>,
			),
		);

		expect(document.activeElement).toBe(element(target));
	});
});
