// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	WindowTitleBarContent,
	WindowTitleBarProvider,
} from "@/components/window-title-bar";

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

describe("WindowTitleBarProvider", () => {
	it("keeps an empty draggable title bar mounted without page content", async () => {
		await act(async () => {
			root.render(
				<WindowTitleBarProvider contentEnabled={false}>
					<main data-testid="page">Settings</main>
				</WindowTitleBarProvider>,
			);
		});

		const titleBar = container.querySelector('[data-slot="window-title-bar"]');
		expect(titleBar?.getAttribute("data-tauri-drag-region")).toBe("deep");
		expect(titleBar?.className).toContain("h-12");
		expect(titleBar?.className).toContain("md:left-(--sidebar-width)");
		expect(titleBar?.className).toContain(
			"md:group-data-[state=collapsed]/sidebar-wrapper:left-(--sidebar-width-icon)",
		);
		expect(container.querySelector('[data-testid="page"]')).not.toBeNull();
	});

	it("projects controls into the title bar and preserves source geometry", async () => {
		await act(async () => {
			root.render(
				<WindowTitleBarProvider>
					<WindowTitleBarContent>
						<button type="button">Session actions</button>
					</WindowTitleBarContent>
				</WindowTitleBarProvider>,
			);
		});

		const titleBar = container.querySelector('[data-slot="window-title-bar"]');
		expect(titleBar?.querySelector("button")?.textContent).toBe(
			"Session actions",
		);
		expect(
			container.querySelector('[data-slot="window-title-bar-spacer"]')
				?.className,
		).toContain("h-12");
	});

	it("clears projected controls while retaining the spacer", async () => {
		await act(async () => {
			root.render(
				<WindowTitleBarProvider contentEnabled={false}>
					<WindowTitleBarContent>
						<button type="button">Hidden chat action</button>
					</WindowTitleBarContent>
				</WindowTitleBarProvider>,
			);
		});

		const titleBar = container.querySelector('[data-slot="window-title-bar"]');
		expect(titleBar?.querySelector("button")).toBeNull();
		expect(
			container.querySelector('[data-slot="window-title-bar-spacer"]'),
		).not.toBeNull();
	});

	it("covers the full window when a shell overlay replaces the sidebar", async () => {
		await act(async () => {
			root.render(
				<WindowTitleBarProvider fullWidth>
					<div>Onboarding</div>
				</WindowTitleBarProvider>,
			);
		});

		const titleBar = container.querySelector('[data-slot="window-title-bar"]');
		expect(titleBar?.className).toContain("left-0");
		expect(titleBar?.className).toContain("z-[60]");
		expect(titleBar?.className).not.toContain("md:left-(--sidebar-width)");
	});
});
