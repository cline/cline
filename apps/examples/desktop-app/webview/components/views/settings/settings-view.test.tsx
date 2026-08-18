// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	APP_FONT_SIZE_STORAGE_KEY,
	applyAppZoomAction,
} from "@/lib/app-font-size";
import { APP_ICON_STORAGE_KEY } from "@/lib/app-icon";
import { SettingsView } from "./settings-view";

const { invoke, isTauriAvailable } = vi.hoisted(() => ({
	invoke: vi.fn(),
	isTauriAvailable: vi.fn(() => false),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	isTauriAvailable,
	openExternalUrl: vi.fn(),
}));
vi.mock("next/image", () => ({
	default: () => <span aria-hidden="true" data-testid="next-image" />,
}));

let container: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
	disconnect() {}
	observe() {}
	unobserve() {}
}

class StorageStub implements Storage {
	readonly #values = new Map<string, string>();
	get length() {
		return this.#values.size;
	}
	clear() {
		this.#values.clear();
	}
	getItem(key: string) {
		return this.#values.get(key) ?? null;
	}
	key(index: number) {
		return [...this.#values.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.#values.delete(key);
	}
	setItem(key: string, value: string) {
		this.#values.set(key, value);
	}
}

beforeEach(() => {
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: new StorageStub(),
	});
	Object.assign(globalThis, {
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: ResizeObserverStub,
	});
	window.localStorage.clear();
	document.documentElement.style.removeProperty("font-size");
	delete document.documentElement.dataset.clineFontSize;
	invoke.mockReset();
	isTauriAvailable.mockReturnValue(false);
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

describe("SettingsView app icon", () => {
	it("selects and persists an app icon", async () => {
		await act(async () => {
			root.render(
				<SettingsView onNavigateSection={vi.fn()} section="General" />,
			);
		});

		const hologramButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Hologram"]',
		);
		expect(hologramButton).not.toBeNull();

		await act(async () => {
			hologramButton?.click();
		});

		expect(hologramButton?.getAttribute("aria-pressed")).toBe("true");
		expect(window.localStorage.getItem(APP_ICON_STORAGE_KEY)).toBe("hologram");
	});

	it("applies rapid native icon selections in request order", async () => {
		isTauriAvailable.mockReturnValue(true);
		let resolveClassic: (() => void) | undefined;
		let resolveHologram: (() => void) | undefined;
		invoke.mockImplementation(
			(command: string, payload?: { icon?: string }) => {
				if (command !== "set_app_icon") {
					return Promise.resolve({
						telemetryOptOut: false,
						autoUpdateEnabled: true,
					});
				}
				return new Promise<void>((resolve) => {
					if (payload?.icon === "classic") resolveClassic = resolve;
					if (payload?.icon === "hologram") resolveHologram = resolve;
				});
			},
		);

		await act(async () => {
			root.render(
				<SettingsView onNavigateSection={vi.fn()} section="General" />,
			);
		});
		const classicButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Classic"]',
		);
		const hologramButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Hologram"]',
		);

		await act(async () => {
			classicButton?.click();
			hologramButton?.click();
			await Promise.resolve();
		});
		expect(resolveClassic).toBeTypeOf("function");
		expect(resolveHologram).toBeUndefined();

		await act(async () => resolveClassic?.());
		expect(resolveHologram).toBeTypeOf("function");
		await act(async () => resolveHologram?.());

		expect(window.localStorage.getItem(APP_ICON_STORAGE_KEY)).toBe("hologram");
		expect(hologramButton?.getAttribute("aria-pressed")).toBe("true");
	});
});
