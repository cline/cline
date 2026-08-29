// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
	window.localStorage.clear();
	document.querySelector('link[rel="icon"]')?.remove();
	invoke.mockReset();
	isTauriAvailable.mockReturnValue(false);
});

describe("app icon", () => {
	it("defaults to the first bot icon and validates stored values", () => {
		expect(DEFAULT_APP_ICON).toBe("001");
		expect(readStoredAppIcon()).toBe(DEFAULT_APP_ICON);
		window.localStorage.setItem(APP_ICON_STORAGE_KEY, "bogus");
		expect(readStoredAppIcon()).toBe(DEFAULT_APP_ICON);
		expect(isAppIconId("001")).toBe(true);
		expect(isAppIconId("bogus")).toBe(false);
	});

	it("persists the choice and swaps the favicon in browser mode", async () => {
		await setStoredAppIcon("003");
		expect(window.localStorage.getItem(APP_ICON_STORAGE_KEY)).toBe("003");
		expect(
			document
				.querySelector<HTMLLinkElement>('link[rel="icon"]')
				?.getAttribute("href"),
		).toBe(appIconAssetPath("003"));
		expect(invoke).not.toHaveBeenCalled();
	});

	it("routes through the native command in the Tauri shell", async () => {
		isTauriAvailable.mockReturnValue(true);
		invoke.mockResolvedValue(true);
		await setStoredAppIcon("001");
		expect(invoke).toHaveBeenCalledWith("set_app_icon", { icon: "001" });
	});

	it("re-applies only non-bundled choices at boot", async () => {
		isTauriAvailable.mockReturnValue(true);
		invoke.mockResolvedValue(true);
		await syncAppIcon();
		expect(invoke).not.toHaveBeenCalled();

		window.localStorage.setItem(APP_ICON_STORAGE_KEY, "002");
		await syncAppIcon();
		expect(invoke).toHaveBeenCalledWith("set_app_icon", { icon: "002" });
	});
});
