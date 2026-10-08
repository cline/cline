// @vitest-environment jsdom

import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_APP_DIRECTION,
	DIRECTION_BOOTSTRAP_SCRIPT,
	DIRECTION_STORAGE_KEY,
	isAppDirection,
	isRtlLanguageTag,
	readStoredDirection,
	resolveDirection,
	setStoredDirection,
	subscribeToDirection,
	syncDirection,
} from "./direction";

function setPreferredLanguages(languages: string[]) {
	Object.defineProperty(window.navigator, "languages", {
		configurable: true,
		value: languages,
	});
	Object.defineProperty(window.navigator, "language", {
		configurable: true,
		value: languages[0] ?? "en",
	});
}

function runDirectionBootstrap(): void {
	runInNewContext(DIRECTION_BOOTSTRAP_SCRIPT, {
		document,
		navigator,
		window,
	});
}

beforeEach(() => {
	window.localStorage.clear();
	setPreferredLanguages(["en-US"]);
	document.documentElement.dir = "ltr";
	delete document.documentElement.dataset.clineDirection;
});

afterEach(() => {
	window.localStorage.clear();
	document.documentElement.dir = "ltr";
	delete document.documentElement.dataset.clineDirection;
	delete (window.navigator as { languages?: unknown }).languages;
	delete (window.navigator as { language?: unknown }).language;
});

describe("app direction", () => {
	it("defaults to auto and resolves the direction from language tags", () => {
		expect(readStoredDirection()).toBe(DEFAULT_APP_DIRECTION);
		expect(DEFAULT_APP_DIRECTION).toBe("auto");

		expect(isAppDirection("ltr")).toBe(true);
		expect(isAppDirection("rtl")).toBe(true);
		expect(isAppDirection("vertical")).toBe(false);

		expect(isRtlLanguageTag("fa")).toBe(true);
		expect(isRtlLanguageTag("fa-IR")).toBe(true);
		expect(isRtlLanguageTag("AR_EG")).toBe(true);
		expect(isRtlLanguageTag("he")).toBe(true);
		expect(isRtlLanguageTag("en-US")).toBe(false);

		expect(resolveDirection("auto", ["en-US"])).toBe("ltr");
		expect(resolveDirection("auto", ["fa-IR"])).toBe("rtl");
		expect(resolveDirection("auto", ["en-US", "ar"])).toBe("rtl");
		expect(resolveDirection("ltr", ["fa-IR"])).toBe("ltr");
		expect(resolveDirection("rtl", ["en-US"])).toBe("rtl");
	});

	it("persists and applies the selected direction", () => {
		expect(setStoredDirection("rtl")).toBe("rtl");
		expect(window.localStorage.getItem(DIRECTION_STORAGE_KEY)).toBe("rtl");
		expect(document.documentElement.dir).toBe("rtl");
		expect(document.documentElement.dataset.clineDirection).toBe("rtl");

		document.documentElement.dir = "ltr";
		expect(syncDirection()).toBe("rtl");
		expect(document.documentElement.dir).toBe("rtl");

		// "auto" stores the preference and applies the system language instead.
		setPreferredLanguages(["fa-IR"]);
		expect(setStoredDirection("auto")).toBe("rtl");
		expect(window.localStorage.getItem(DIRECTION_STORAGE_KEY)).toBe("auto");
		expect(readStoredDirection()).toBe("auto");
		expect(document.documentElement.dir).toBe("rtl");
	});

	it("notifies subscribers when the applied direction changes", () => {
		const onChange = vi.fn();
		const unsubscribe = subscribeToDirection(onChange);

		setStoredDirection("rtl");
		expect(onChange).toHaveBeenLastCalledWith("rtl");

		unsubscribe();
		setStoredDirection("ltr");
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it("applies the stored preference before paint from the bootstrap script", () => {
		window.localStorage.setItem(DIRECTION_STORAGE_KEY, "rtl");
		document.documentElement.dir = "";
		runDirectionBootstrap();
		expect(document.documentElement.dir).toBe("rtl");
		expect(document.documentElement.dataset.clineDirection).toBe("rtl");
	});

	it("falls back to the system language from the bootstrap script", () => {
		setPreferredLanguages(["fa-IR"]);
		document.documentElement.dir = "";
		runDirectionBootstrap();
		expect(document.documentElement.dir).toBe("rtl");

		setPreferredLanguages(["en-GB"]);
		document.documentElement.dir = "";
		runDirectionBootstrap();
		expect(document.documentElement.dir).toBe("ltr");
	});
});
