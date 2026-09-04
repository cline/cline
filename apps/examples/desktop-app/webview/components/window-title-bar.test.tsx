// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	WindowTitleBar,
	WindowTitleBarContent,
	WindowTitleBarProvider,
} from "@/components/window-title-bar";

const windowMocks = vi.hoisted(() => ({
	close: vi.fn(),
	isMaximized: vi.fn(async () => false),
	minimize: vi.fn(),
	onResized: vi.fn(async () => () => undefined),
	toggleMaximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => windowMocks,
}));
vi.mock("@/lib/desktop-client", () => ({
	isTauriAvailable: () => "__TAURI_INTERNALS__" in window,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	windowMocks.close.mockReset();
	windowMocks.isMaximized.mockReset();
	windowMocks.isMaximized.mockResolvedValue(false);
	windowMocks.minimize.mockReset();
	windowMocks.onResized.mockReset();
	windowMocks.onResized.mockResolvedValue(() => undefined);
	windowMocks.toggleMaximize.mockReset();
	delete (window as Window & { __TAURI_INTERNALS__?: unknown })
		.__TAURI_INTERNALS__;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	delete (window as Window & { __TAURI_INTERNALS__?: unknown })
		.__TAURI_INTERNALS__;
	vi.unstubAllGlobals();
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
	it("renders Windows caption controls and invokes the native window actions", async () => {
		Object.defineProperty(window, "__TAURI_INTERNALS__", {
			configurable: true,
			value: {},
		});
		vi.stubGlobal("navigator", { userAgent: "Windows NT 10.0" });
		windowMocks.isMaximized.mockResolvedValue(true);

		await act(async () => root.render(renderShell(true)));
		await act(async () => Promise.resolve());

		const controls = container.querySelector<HTMLElement>(
			'[data-slot="window-controls"]',
		);
		expect(controls).not.toBeNull();
		if (!controls) {
			throw new Error("Expected Windows caption controls");
		}
		expect(controls.querySelector('[aria-label="Restore"]')).not.toBeNull();
		await act(async () => {
			controls
				.querySelector<HTMLButtonElement>('[aria-label="Minimize"]')
				?.click();
			controls
				.querySelector<HTMLButtonElement>('[aria-label="Restore"]')
				?.click();
			controls
				.querySelector<HTMLButtonElement>('[aria-label="Close"]')
				?.click();
		});
		expect(windowMocks.minimize).toHaveBeenCalledOnce();
		expect(windowMocks.toggleMaximize).toHaveBeenCalledOnce();
		expect(windowMocks.close).toHaveBeenCalledOnce();
	});

	it("does not render caption controls outside the Windows desktop app", async () => {
		vi.stubGlobal("navigator", { userAgent: "Windows NT 10.0" });
		await act(async () => root.render(renderShell(true)));
		expect(container.querySelector('[data-slot="window-controls"]')).toBeNull();
	});

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
