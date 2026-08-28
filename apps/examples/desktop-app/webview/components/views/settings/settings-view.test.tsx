// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	APP_FONT_SIZE_STORAGE_KEY,
	applyAppZoomAction,
} from "@/lib/app-font-size";
import type { Provider } from "@/lib/provider-schema";
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
	window.localStorage.clear();
	document.documentElement.style.removeProperty("font-size");
	delete document.documentElement.dataset.clineFontSize;
	invoke.mockReset();
	invoke.mockResolvedValue({
		telemetryOptOut: false,
		autoUpdateEnabled: true,
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("SettingsView font size", () => {
	it("loads the saved size and updates it from the General settings controls", async () => {
		window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, "17");

		await act(async () => {
			root.render(
				<SettingsView onNavigateSection={vi.fn()} section="General" />,
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

describe("SettingsView provider models", () => {
	it("requests a forced live refresh when the refresh button is clicked", async () => {
		const provider: Provider = {
			id: "tencent-coding-plan",
			name: "Tencent Coding Plan (China)",
			models: 1,
			color: "#000000",
			letter: "TC",
			enabled: false,
			baseUrl: "https://api.lkeap.cloud.tencent.com/coding/v3",
			modelList: [{ id: "cached-model", name: "Cached Model" }],
		};
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_provider_catalog") {
				return { providers: [provider], settingsPath: "/tmp/providers.json" };
			}
			if (command === "list_provider_models") {
				return {
					providerId: provider.id,
					models: [{ id: "live-model", name: "Live Model" }],
				};
			}
			return { telemetryOptOut: false, autoUpdateEnabled: true };
		});

		await act(async () => {
			root.render(
				<SettingsView onNavigateSection={vi.fn()} section="Models" />,
			);
		});
		await act(async () => {
			await new Promise((resolve) => window.setTimeout(resolve, 0));
		});
		await act(async () => {
			await new Promise((resolve) => window.setTimeout(resolve, 0));
		});

		const refreshButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Refresh models"]',
		);
		expect(refreshButton).not.toBeNull();
		expect(refreshButton?.disabled).toBe(false);
		const initialModelCalls = invoke.mock.calls.filter(
			([command]) => command === "list_provider_models",
		);
		expect(initialModelCalls).toHaveLength(1);

		await act(async () => {
			refreshButton?.click();
			await new Promise((resolve) => window.setTimeout(resolve, 0));
		});

		const modelCalls = invoke.mock.calls.filter(
			([command]) => command === "list_provider_models",
		);
		expect(modelCalls).toHaveLength(2);
		expect(modelCalls.at(-1)).toEqual([
			"list_provider_models",
			{ provider: provider.id, force_refresh: true },
		]);
	});
});
