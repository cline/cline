// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, isTauriAvailable } = vi.hoisted(() => ({
	invoke: vi.fn(),
	isTauriAvailable: vi.fn(() => false),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	isTauriAvailable,
}));

import {
	APP_ICON_STORAGE_KEY,
	appIconAssetPath,
	DEFAULT_APP_ICON,
	isAppIconId,
	readStoredAppIcon,
	setStoredAppIcon,
	syncAppIcon,
} from "./app-icon";

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
});

afterEach(() => {
	window.localStorage.clear();
	document.querySelector('link[rel="icon"]')?.remove();
	invoke.mockReset();
	isTauriAvailable.mockReturnValue(false);
});

describe("app icon", () => {
	it("defaults to the bundled midnight icon and validates stored values", () => {
		expect(DEFAULT_APP_ICON).toBe("midnight");
		expect(readStoredAppIcon()).toBe(DEFAULT_APP_ICON);
		window.localStorage.setItem(APP_ICON_STORAGE_KEY, "bogus");
		expect(readStoredAppIcon()).toBe(DEFAULT_APP_ICON);
		expect(isAppIconId("midnight")).toBe(true);
		expect(isAppIconId("hologram")).toBe(true);
		expect(isAppIconId("steel")).toBe(false);
		expect(isAppIconId("sunrise")).toBe(false);
		expect(isAppIconId("bogus")).toBe(false);
	});

	it("migrates the replaced sunrise preference to hologram", () => {
		window.localStorage.setItem(APP_ICON_STORAGE_KEY, "sunrise");

		expect(readStoredAppIcon()).toBe("hologram");
		expect(window.localStorage.getItem(APP_ICON_STORAGE_KEY)).toBe("hologram");
	});

	it("persists the choice and swaps the favicon in browser mode", async () => {
		await setStoredAppIcon("classic");
		expect(window.localStorage.getItem(APP_ICON_STORAGE_KEY)).toBe("classic");
		expect(
			document
				.querySelector<HTMLLinkElement>('link[rel="icon"]')
				?.getAttribute("href"),
		).toBe(appIconAssetPath("classic"));
		expect(invoke).not.toHaveBeenCalled();
	});

	it("routes through the native command in the Tauri shell", async () => {
		isTauriAvailable.mockReturnValue(true);
		invoke.mockResolvedValue(true);
		await setStoredAppIcon("midnight");
		expect(invoke).toHaveBeenCalledWith("set_app_icon", { icon: "midnight" });
	});

	it("does not persist a native selection that fails to apply", async () => {
		isTauriAvailable.mockReturnValue(true);
		invoke.mockRejectedValue(new Error("AppKit rejected the icon"));

		await expect(setStoredAppIcon("classic")).rejects.toThrow(
			"AppKit rejected the icon",
		);
		expect(window.localStorage.getItem(APP_ICON_STORAGE_KEY)).toBeNull();
	});

	it("re-applies only non-bundled choices at boot", async () => {
		isTauriAvailable.mockReturnValue(true);
		invoke.mockResolvedValue(true);
		await syncAppIcon();
		expect(invoke).not.toHaveBeenCalled();

		window.localStorage.setItem(APP_ICON_STORAGE_KEY, "classic");
		await syncAppIcon();
		expect(invoke).toHaveBeenCalledWith("set_app_icon", { icon: "classic" });
	});
});
