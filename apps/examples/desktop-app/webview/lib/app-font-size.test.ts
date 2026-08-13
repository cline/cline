// @vitest-environment jsdom

import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
	APP_FONT_SIZE_BOOTSTRAP_SCRIPT,
	APP_FONT_SIZE_STORAGE_KEY,
	DEFAULT_APP_FONT_SIZE,
	isAppFontSize,
	readStoredAppFontSize,
	setStoredAppFontSize,
	syncAppFontSize,
} from "./app-font-size";

afterEach(() => {
	window.localStorage.clear();
	document.documentElement.style.removeProperty("font-size");
	delete document.documentElement.dataset.clineFontSize;
});

function runFontSizeBootstrap(): void {
	runInNewContext(APP_FONT_SIZE_BOOTSTRAP_SCRIPT, { document, window });
}

describe("app font size", () => {
	it("defaults invalid and missing preferences to 15px", () => {
		expect(readStoredAppFontSize()).toBe(DEFAULT_APP_FONT_SIZE);
		expect(isAppFontSize(12)).toBe(true);
		expect(isAppFontSize(20)).toBe(true);
		expect(isAppFontSize(11)).toBe(false);
		expect(isAppFontSize(15.5)).toBe(false);

		window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, "large");
		expect(readStoredAppFontSize()).toBe(DEFAULT_APP_FONT_SIZE);
	});

	it("persists and applies the selected size", () => {
		expect(setStoredAppFontSize(18)).toBe(18);
		expect(window.localStorage.getItem(APP_FONT_SIZE_STORAGE_KEY)).toBe("18");
		expect(document.documentElement.style.fontSize).toBe("18px");
		expect(document.documentElement.dataset.clineFontSize).toBe("18");

		document.documentElement.style.removeProperty("font-size");
		expect(syncAppFontSize()).toBe(18);
		expect(document.documentElement.style.fontSize).toBe("18px");
	});

	it("restores the saved size before the first paint", () => {
		window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, "19");

		runFontSizeBootstrap();

		expect(document.documentElement.style.fontSize).toBe("19px");
		expect(document.documentElement.dataset.clineFontSize).toBe("19");
	});

	it("uses the default before paint when storage is invalid", () => {
		window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, "21");

		runFontSizeBootstrap();

		expect(document.documentElement.style.fontSize).toBe("15px");
		expect(document.documentElement.dataset.clineFontSize).toBe("15");
	});
});
