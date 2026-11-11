// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	APP_FONT_SIZE_STORAGE_KEY,
	applyAppZoomAction,
} from "@/lib/app-font-size";
import { SettingsView } from "./settings-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
let desktopSettings = {
	cloudAgentsEnabled: true,
	cloudAgentsRolloutEnabled: true,
};
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
	if (typeof window.localStorage.clear !== "function") {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: window.sessionStorage,
		});
	}
	window.localStorage.clear();
	document.documentElement.style.removeProperty("font-size");
	delete document.documentElement.dataset.clineFontSize;
	desktopSettings = {
		cloudAgentsEnabled: true,
		cloudAgentsRolloutEnabled: true,
	};
	invoke.mockReset();
	invoke.mockImplementation(async (command: string) => {
		if (command === "get_hub_status") {
			return { url: "ws://127.0.0.1:1234", clients: [], events: [] };
		}
		if (command === "get_desktop_settings") {
			return desktopSettings;
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
});

describe("SettingsView font size", () => {
	it("loads the saved size and updates it from the General settings controls", async () => {
		window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, "17");

		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
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

describe("SettingsView cloud agents", () => {
	async function renderGeneral(): Promise<void> {
		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="General"
				/>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => window.setTimeout(resolve, 0));
		});
	}

	function cloudSwitch(): HTMLInputElement | null {
		return container.querySelector<HTMLInputElement>(
			'[aria-label="Enable cloud agents"]',
		);
	}

	it("shows the row when the rollout is on", async () => {
		await renderGeneral();
		expect(container.textContent).toContain("Enable cloud agents");
		expect(container.textContent).toContain(
			"Show Cloud as an environment and allow handing sessions off to Cloud. Turn off to keep everything local.",
		);
		expect(cloudSwitch()?.checked).toBe(true);
		expect(cloudSwitch()?.disabled).toBe(false);
	});

	it("hides the row when the rollout is off", async () => {
		desktopSettings = {
			cloudAgentsEnabled: true,
			cloudAgentsRolloutEnabled: false,
		};
		await renderGeneral();
		expect(cloudSwitch()).toBeNull();
		expect(container.textContent).not.toContain("Enable cloud agents");
	});

	it("reflects a saved off preference", async () => {
		desktopSettings = {
			cloudAgentsEnabled: false,
			cloudAgentsRolloutEnabled: true,
		};
		await renderGeneral();
		expect(cloudSwitch()?.checked).toBe(false);
	});

	it("saves the toggle through set_cloud_agents_enabled", async () => {
		const baseline = invoke.getMockImplementation();
		invoke.mockImplementation(async (command: string, args?: unknown) => {
			if (command === "set_cloud_agents_enabled") {
				return {
					cloudAgentsEnabled: (args as { cloud_agents_enabled: boolean })
						.cloud_agents_enabled,
					cloudAgentsRolloutEnabled: true,
				};
			}
			return baseline?.(command, args);
		});
		await renderGeneral();
		await act(async () => {
			cloudSwitch()?.click();
		});
		expect(invoke).toHaveBeenCalledWith("set_cloud_agents_enabled", {
			cloud_agents_enabled: false,
		});
		expect(cloudSwitch()?.checked).toBe(false);
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});

	it("rolls the switch back and shows an error when saving fails", async () => {
		const baseline = invoke.getMockImplementation();
		invoke.mockImplementation(async (command: string, args?: unknown) => {
			if (command === "set_cloud_agents_enabled") {
				throw new Error("disk full");
			}
			return baseline?.(command, args);
		});
		await renderGeneral();
		await act(async () => {
			cloudSwitch()?.click();
		});
		expect(cloudSwitch()?.checked).toBe(true);
		expect(cloudSwitch()?.disabled).toBe(false);
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"disk full",
		);
	});
});
