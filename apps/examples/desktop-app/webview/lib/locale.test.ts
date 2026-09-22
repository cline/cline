// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
	APP_LOCALE_CHANGE_EVENT,
	APP_LOCALE_STORAGE_KEY,
	APP_LOCALES,
	type AppLocale,
	I18N_BOOTSTRAP_SCRIPT,
	readInitialLocale,
	readStoredLocalePreference,
	resolveAppLocale,
	setStoredLocale,
	subscribeToLocale,
} from "./locale";

function evalBootstrap(): void {
	// biome-ignore lint/security/noGlobalEval: executes the same head script the app injects
	window.eval(I18N_BOOTSTRAP_SCRIPT);
}

beforeEach(() => {
	window.localStorage.clear();
	delete window.__CLINE_LOCALE__;
	delete document.documentElement.dataset.clineLocale;
	document.documentElement.lang = "";
});

describe("locale preference storage", () => {
	it("defaults to the system preference when nothing is stored", () => {
		expect(readStoredLocalePreference()).toBe("system");
	});

	it("round-trips a stored locale", () => {
		setStoredLocale("zh-Hans");
		expect(readStoredLocalePreference()).toBe("zh-Hans");
		expect(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("zh-Hans");
	});

	it("treats an unknown stored value as the system preference", () => {
		window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, "klingon");
		expect(readStoredLocalePreference()).toBe("system");
	});

	it("notifies subscribers through the change event", () => {
		const seen: AppLocale[] = [];
		const unsubscribe = subscribeToLocale((locale) => seen.push(locale));
		setStoredLocale("zh-Hans");
		unsubscribe();
		setStoredLocale("en");
		expect(seen).toEqual(["zh-Hans"]);
	});

	it("dispatches the documented change event name", () => {
		let eventName = "";
		const listener = (event: Event) => {
			eventName = event.type;
		};
		window.addEventListener(APP_LOCALE_CHANGE_EVENT, listener);
		setStoredLocale("en");
		window.removeEventListener(APP_LOCALE_CHANGE_EVENT, listener);
		expect(eventName).toBe(APP_LOCALE_CHANGE_EVENT);
	});
});

describe("resolveAppLocale", () => {
	it("follows the OS language list for the system preference", () => {
		expect(resolveAppLocale("system", ["zh-CN", "en"])).toBe("zh-Hans");
		expect(resolveAppLocale("system", ["en-GB", "fr"])).toBe("en");
		expect(resolveAppLocale("system", ["fr", "de"])).toBe("en");
	});

	it("maps every Chinese variant to the shipped catalog", () => {
		expect(resolveAppLocale("zh-Hant", [])).toBe("zh-Hans");
		expect(resolveAppLocale("zh-Hans", [])).toBe("zh-Hans");
		expect(resolveAppLocale("system", ["zh-TW"])).toBe("zh-Hans");
	});

	it("covers every shipped locale", () => {
		expect(APP_LOCALES).toEqual(["en", "zh-Hans"]);
		expect(resolveAppLocale("en", [])).toBe("en");
	});
});

describe("I18N_BOOTSTRAP_SCRIPT", () => {
	it("defaults to English when nothing is stored and the OS is not Chinese", () => {
		Object.defineProperty(navigator, "languages", {
			configurable: true,
			value: ["en-US"],
		});
		evalBootstrap();
		expect(document.documentElement.lang).toBe("en");
		expect(readInitialLocale()).toBe("en");
		expect(document.documentElement.dataset.clineLocale).toBe("en");
	});

	it("resolves Chinese from the stored preference", () => {
		window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, "zh-Hans");
		Object.defineProperty(navigator, "languages", {
			configurable: true,
			value: ["en-US"],
		});
		evalBootstrap();
		expect(document.documentElement.lang).toBe("zh-Hans");
		expect(readInitialLocale()).toBe("zh-Hans");
	});

	it("ignores a stored locale it does not ship", () => {
		window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, "klingon");
		Object.defineProperty(navigator, "languages", {
			configurable: true,
			value: ["en-US"],
		});
		evalBootstrap();
		expect(document.documentElement.lang).toBe("en");
	});

	it("derives Chinese from the OS when the preference is system", () => {
		window.localStorage.removeItem(APP_LOCALE_STORAGE_KEY);
		Object.defineProperty(navigator, "languages", {
			configurable: true,
			value: ["zh-CN", "en"],
		});
		evalBootstrap();
		expect(document.documentElement.lang).toBe("zh-Hans");
	});
});
