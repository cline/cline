// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	APP_FONT_SIZE_STORAGE_KEY,
	applyAppZoomAction,
} from "@/lib/app-font-size";
import * as whatsNew from "@/lib/whats-new";
import { SettingsView } from "./settings-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	isTauriAvailable: vi.fn(() => false),
	openExternalUrl: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
	disconnect() {}
	observe() {}
	unobserve() {}
}

beforeEach(() => {
	Object.assign(globalThis, {
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: ResizeObserverStub,
	});
	if (typeof window.localStorage?.clear !== "function") {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: window.sessionStorage,
		});
	}
	window.localStorage.clear();
	document.documentElement.style.removeProperty("font-size");
	delete document.documentElement.dataset.clineFontSize;
	invoke.mockReset();
	invoke.mockImplementation(async (command: string) => {
		if (command === "get_hub_status") {
			return { url: "ws://127.0.0.1:1234", clients: [], events: [] };
		}
		return { telemetryOptOut: false, autoUpdateEnabled: true };
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

it("forwards the About highlights' Connectors action to the app", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(JSON.stringify({ releases: [] })),
	);
	vi.spyOn(whatsNew, "latestWhatsNew").mockReturnValue({
		id: "test-connectors",
		title: "Connect your apps",
		spotlight: "connectors",
	});
	const onOpenConnectors = vi.fn();
	const onNavigateSection = vi.fn();
	await act(async () =>
		root.render(
			<SettingsView
				onExportDiagnostics={vi.fn()}
				onNavigateSection={onNavigateSection}
				onOpenConnectors={onOpenConnectors}
				section="About"
			/>,
		),
	);
	const highlights = [...container.querySelectorAll("button")].find(
		(button) => button.textContent === "Show what's new",
	);
	expect(highlights).toBeDefined();
	await act(async () => highlights?.click());
	const openConnectors = [
		...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
	].find((button) => button.textContent === "Open Connectors");
	expect(openConnectors).toBeDefined();
	await act(async () => openConnectors?.click());
	expect(onOpenConnectors).toHaveBeenCalledOnce();
	expect(onNavigateSection).not.toHaveBeenCalled();
});

describe("SettingsView font size", () => {
	it("loads the saved size and updates it from the General settings controls", async () => {
		window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, "17");

		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					onOpenConnectors={vi.fn()}
					section="General"
				/>,
			);
		});

		const slider = container.querySelector<HTMLElement>(
			'[role="slider"][aria-label="Font size"]',
		);
		const increaseButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Increase font size"]',
		);
		expect(slider?.getAttribute("aria-valuenow")).toBe("17");
		expect(increaseButton).not.toBeNull();
		expect(increaseButton?.disabled).toBe(false);
		expect(container.textContent).toContain("17px");

		await act(async () => {
			increaseButton?.click();
		});

		expect(window.localStorage.getItem(APP_FONT_SIZE_STORAGE_KEY)).toBe("18");
		expect(document.documentElement.style.fontSize).toBe("18px");
		const updatedSlider = container.querySelector<HTMLElement>(
			'[role="slider"][aria-label="Font size"]',
		);
		expect(updatedSlider).toBe(slider);
		expect(updatedSlider?.getAttribute("aria-valuenow")).toBe("18");

		await act(async () => {
			updatedSlider?.focus();
			updatedSlider?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
			);
		});

		expect(window.localStorage.getItem(APP_FONT_SIZE_STORAGE_KEY)).toBe("19");
		expect(document.documentElement.style.fontSize).toBe("19px");
		expect(updatedSlider?.getAttribute("aria-valuenow")).toBe("19");

		await act(async () => {
			applyAppZoomAction("zoom-in");
		});

		expect(window.localStorage.getItem(APP_FONT_SIZE_STORAGE_KEY)).toBe("20");
		expect(container.textContent).toContain("20px");
		expect(updatedSlider?.getAttribute("aria-valuenow")).toBe("20");
		expect(increaseButton?.disabled).toBe(true);
	});
});
