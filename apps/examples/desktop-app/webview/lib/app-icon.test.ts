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
	it("defaults to classic and validates stored values", () => {
		expect(readStoredAppIcon()).toBe(DEFAULT_APP_ICON);
		window.localStorage.setItem(APP_ICON_STORAGE_KEY, "bogus");
		expect(readStoredAppIcon()).toBe(DEFAULT_APP_ICON);
		expect(isAppIconId("midnight")).toBe(true);
		expect(isAppIconId("bogus")).toBe(false);
	});

	it("persists the choice and swaps the favicon in browser mode", async () => {
		await setStoredAppIcon("steel");
		expect(window.localStorage.getItem(APP_ICON_STORAGE_KEY)).toBe("steel");
		expect(
			document
				.querySelector<HTMLLinkElement>('link[rel="icon"]')
				?.getAttribute("href"),
		).toBe(appIconAssetPath("steel"));
		expect(invoke).not.toHaveBeenCalled();
	});

	it("routes through the native command in the Tauri shell", async () => {
		isTauriAvailable.mockReturnValue(true);
		invoke.mockResolvedValue(true);
		await setStoredAppIcon("midnight");
		expect(invoke).toHaveBeenCalledWith("set_app_icon", { icon: "midnight" });
	});

	it("re-applies only non-default choices at boot", async () => {
		isTauriAvailable.mockReturnValue(true);
		invoke.mockResolvedValue(true);
		await syncAppIcon();
		expect(invoke).not.toHaveBeenCalled();

		window.localStorage.setItem(APP_ICON_STORAGE_KEY, "sunrise");
		await syncAppIcon();
		expect(invoke).toHaveBeenCalledWith("set_app_icon", { icon: "sunrise" });
	});
});
