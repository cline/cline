// @vitest-environment jsdom

import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
	APP_ACCENT_STORAGE_KEY,
	APP_THEME_BOOTSTRAP_SCRIPT,
	APP_THEME_STORAGE_KEY,
	applyAppAccent,
	DEFAULT_APP_ACCENT,
	DEFAULT_APP_THEME,
	isAppAccent,
	readStoredAppAccent,
	readStoredAppTheme,
	readSystemAppTheme,
	setStoredAppAccent,
	syncAppAccent,
	syncAppTheme,
} from "./theme";

afterEach(() => {
	window.localStorage.clear();
	delete document.body.dataset.vscodeThemeKind;
	document.documentElement.classList.remove("dark");
	delete document.documentElement.dataset.clineAccent;
	delete document.documentElement.dataset.clineAppTheme;
	Reflect.deleteProperty(window, "matchMedia");
});

function setSystemTheme(theme: "light" | "dark" | null): void {
	window.matchMedia = ((query: string) =>
		({
			matches: theme !== null && query === `(prefers-color-scheme: ${theme})`,
			media: query,
			addEventListener() {},
			removeEventListener() {},
		}) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function runThemeBootstrap(): void {
	runInNewContext(APP_THEME_BOOTSTRAP_SCRIPT, { document, window });
}

describe("app theme", () => {
	it("applies a saved theme before the system preference", () => {
		setSystemTheme("light");
		window.localStorage.setItem(APP_THEME_STORAGE_KEY, "dark");

		runThemeBootstrap();

		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.dataset.clineAppTheme).toBe("dark");
	});

	it("applies the system preference before the first paint when unsaved", () => {
		setSystemTheme("light");

		runThemeBootstrap();

		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(document.documentElement.dataset.clineAppTheme).toBe("light");
	});

	it("defaults to dark when no saved or system preference is available", () => {
		expect(readStoredAppTheme()).toBeNull();
		expect(readSystemAppTheme()).toBe(DEFAULT_APP_THEME);
		expect(syncAppTheme()).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		document.documentElement.classList.remove("dark");
		delete document.documentElement.dataset.clineAppTheme;
		runThemeBootstrap();

		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.dataset.clineAppTheme).toBe("dark");
	});
});

describe("app accent", () => {
	it("defaults to violet and validates stored values", () => {
		expect(readStoredAppAccent()).toBe(DEFAULT_APP_ACCENT);
		window.localStorage.setItem(APP_ACCENT_STORAGE_KEY, "not-a-color");
		expect(readStoredAppAccent()).toBe(DEFAULT_APP_ACCENT);
		expect(isAppAccent("ember")).toBe(true);
		expect(isAppAccent("magenta")).toBe(false);
	});

	it("round-trips through storage and the html dataset", () => {
		setStoredAppAccent("graphite");
		expect(window.localStorage.getItem(APP_ACCENT_STORAGE_KEY)).toBe(
			"graphite",
		);
		expect(document.documentElement.dataset.clineAccent).toBe("graphite");

		expect(syncAppAccent()).toBe("graphite");
		expect(document.documentElement.dataset.clineAccent).toBe("graphite");
	});

	it("clears the dataset attribute for the default accent", () => {
		applyAppAccent("ember");
		expect(document.documentElement.dataset.clineAccent).toBe("ember");
		applyAppAccent(DEFAULT_APP_ACCENT);
		expect(document.documentElement.dataset.clineAccent).toBeUndefined();
	});
});
