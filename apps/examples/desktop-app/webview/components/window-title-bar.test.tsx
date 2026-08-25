// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	WindowTitleBar,
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

function StatefulProjectedControl() {
	const [count, setCount] = useState(0);
	return (
		<button
			data-testid="projected-control"
			type="button"
			onClick={() => setCount((value) => value + 1)}
		>
			Count {count}
		</button>
	);
}

function renderShell(contentEnabled: boolean) {
	return (
		<WindowTitleBarProvider contentEnabled={contentEnabled}>
			<nav>Sidebar</nav>
			<main>
				<button data-testid="sidebar-trigger" type="button">
					Toggle Sidebar
				</button>
				<WindowTitleBar />
				<section data-testid="page">Page content</section>
				<WindowTitleBarContent>
					<StatefulProjectedControl />
				</WindowTitleBarContent>
			</main>
		</WindowTitleBarProvider>
	);
}

describe("WindowTitleBar", () => {
	it("reserves an in-flow draggable row before page content inside main", async () => {
		await act(async () => root.render(renderShell(false)));

		const main = container.querySelector("main");
		const titleBar = main?.querySelector('[data-slot="window-title-bar"]');
		const page = main?.querySelector('[data-testid="page"]');
		expect(titleBar?.getAttribute("data-tauri-drag-region")).toBe("deep");
		expect(titleBar?.className).toContain("h-12");
		expect(titleBar?.className).toContain("shrink-0");
		expect(titleBar?.nextElementSibling).toBe(page);
	});

	it("projects controls into the title bar within the main landmark", async () => {
		await act(async () => root.render(renderShell(true)));

		const titleBar = container.querySelector('[data-slot="window-title-bar"]');
		const button = titleBar?.querySelector("button");
		expect(button?.textContent).toBe("Count 0");
		expect(button?.closest("main")).not.toBeNull();
		expect(
			container
				.querySelector('[data-testid="sidebar-trigger"]')
				?.compareDocumentPosition(button!),
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		expect(
			container.querySelector("nav")?.compareDocumentPosition(button!),
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("hides projected controls without unmounting their state", async () => {
		await act(async () => root.render(renderShell(true)));
		const button = container.querySelector(
			'[data-testid="projected-control"]',
		) as HTMLButtonElement | null;
		await act(async () => button?.click());
		expect(
			container.querySelector('[data-testid="projected-control"]')?.textContent,
		).toBe("Count 1");

		await act(async () => root.render(renderShell(false)));
		const hiddenHost = container.querySelector<HTMLDivElement>(
			'[data-slot="window-title-bar-content-host"]',
		);
		expect(hiddenHost?.hidden).toBe(true);
		expect(
			container.querySelector('[data-testid="projected-control"]')?.textContent,
		).toBe("Count 1");

		await act(async () => root.render(renderShell(true)));
		expect(
			container.querySelector<HTMLDivElement>(
				'[data-slot="window-title-bar-content-host"]',
			)?.hidden,
		).toBe(false);
		expect(
			container.querySelector('[data-testid="projected-control"]')?.textContent,
		).toBe("Count 1");
	});

	it("renders a drag-only row for a full-screen shell overlay", async () => {
		await act(async () => {
			root.render(
				<WindowTitleBarProvider>
					<div className="relative" data-testid="onboarding-shell">
						<WindowTitleBar
							className="absolute inset-x-0 top-0"
							hostContent={false}
						/>
						<div data-testid="onboarding-content">Onboarding</div>
					</div>
				</WindowTitleBarProvider>,
			);
		});

		const shell = container.querySelector('[data-testid="onboarding-shell"]');
		const titleBar = shell?.querySelector('[data-slot="window-title-bar"]');
		expect(titleBar?.className).toContain("absolute");
		expect(titleBar?.nextElementSibling).toBe(
			shell?.querySelector('[data-testid="onboarding-content"]'),
		);
		expect(
			titleBar?.querySelector('[data-slot="window-title-bar-content-host"]'),
		).toBeNull();
	});
});
