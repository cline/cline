// @vitest-environment jsdom

import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
	APP_LOCALE_BOOTSTRAP_SCRIPT,
	APP_LOCALE_STORAGE_KEY,
	APP_LOCALES,
	appLocaleInfo,
	DEFAULT_APP_LOCALE,
	isAppLocale,
	readStoredAppLocale,
	setStoredAppLocale,
	subscribeToAppLocale,
} from "./app-locale";

afterEach(() => {
	window.localStorage.clear();
	delete document.documentElement.dataset.clineLocale;
	document.documentElement.removeAttribute("lang");
});

function runLocaleBootstrap(): void {
	runInNewContext(APP_LOCALE_BOOTSTRAP_SCRIPT, { document, window });
}

describe("app locale", () => {
	it("rejects anything outside the registry", () => {
		expect(readStoredAppLocale()).toBe(DEFAULT_APP_LOCALE);
		expect(isAppLocale("en")).toBe(true);
		expect(isAppLocale("zh-CN")).toBe(true);
		expect(isAppLocale("de")).toBe(false);
		expect(isAppLocale("")).toBe(false);
		expect(isAppLocale(null)).toBe(false);

		window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, "de");
		expect(readStoredAppLocale()).toBe(DEFAULT_APP_LOCALE);
	});

	it("names every language in its own script", () => {
		// A reader who cannot read the current interface is the reader choosing a
		// language, so the option must be recognisable without translation.
		const labels = APP_LOCALES.map((locale) => locale.label);
		expect(new Set(labels).size).toBe(labels.length);
		expect(labels).toContain("日本語");
		expect(labels).toContain("한국어");
		expect(labels).toContain("Tiếng Việt");
		for (const locale of APP_LOCALES) {
			expect(locale.code).toBeTruthy();
			expect(locale.englishLabel).toBeTruthy();
		}
	});

	it("persists and applies the selection, and tells subscribers", () => {
		const seen: string[] = [];
		const unsubscribe = subscribeToAppLocale((locale) => seen.push(locale));

		expect(setStoredAppLocale("ja")).toBe("ja");
		expect(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("ja");
		expect(document.documentElement.lang).toBe("ja");
		expect(document.documentElement.dataset.clineLocale).toBe("ja");
		expect(seen).toEqual(["ja"]);

		setStoredAppLocale("en");
		expect(seen).toEqual(["ja", "en"]);
		unsubscribe();
		setStoredAppLocale("ko");
		expect(seen).toEqual(["ja", "en"]);
	});

	it("falls back to an unknown code's own label rather than guessing", () => {
		expect(appLocaleInfo("zh-CN").label).toBe("简体中文");
		expect(appLocaleInfo("klingon").code).toBe(DEFAULT_APP_LOCALE);
	});

	it("applies the stored locale before first paint", () => {
		window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, "zh-TW");
		runLocaleBootstrap();
		expect(document.documentElement.lang).toBe("zh-TW");

		window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, "xx");
		runLocaleBootstrap();
		expect(document.documentElement.lang).toBe(DEFAULT_APP_LOCALE);
	});
});
