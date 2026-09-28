// @vitest-environment jsdom

import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
	applyHubAccent,
	DEFAULT_HUB_ACCENT,
	DEFAULT_HUB_THEME,
	HUB_ACCENT_STORAGE_KEY,
	HUB_THEME_BOOTSTRAP_SCRIPT,
	HUB_THEME_STORAGE_KEY,
	isHubAccent,
	readHubThemePreference,
	readStoredHubAccent,
	readStoredHubTheme,
	readSystemHubTheme,
	setHubThemePreference,
	setStoredHubAccent,
	syncHubAccent,
	syncHubTheme,
	watchSystemHubTheme,
} from "./theme";

afterEach(() => {
	window.localStorage.clear();
	delete document.body.dataset.vscodeThemeKind;
	document.documentElement.classList.remove("dark");
	delete document.documentElement.dataset.clineAccent;
	delete document.documentElement.dataset.clineHubTheme;
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
	runInNewContext(HUB_THEME_BOOTSTRAP_SCRIPT, { document, window });
}

describe("hub theme", () => {
	it("applies a saved theme before the system preference", () => {
		setSystemTheme("light");
		window.localStorage.setItem(HUB_THEME_STORAGE_KEY, "dark");

		runThemeBootstrap();

		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.dataset.clineHubTheme).toBe("dark");
	});

	it("applies the system preference before the first paint when unsaved", () => {
		setSystemTheme("light");

		runThemeBootstrap();

		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(document.documentElement.dataset.clineHubTheme).toBe("light");
	});

	it("defaults to dark when no saved or system preference is available", () => {
		expect(readStoredHubTheme()).toBeNull();
		expect(readSystemHubTheme()).toBe(DEFAULT_HUB_THEME);
		expect(syncHubTheme()).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		document.documentElement.classList.remove("dark");
		delete document.documentElement.dataset.clineHubTheme;
		runThemeBootstrap();

		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.dataset.clineHubTheme).toBe("dark");
	});
});

describe("hub theme preference", () => {
	it("reports system until a theme is saved", () => {
		expect(readHubThemePreference()).toBe("system");

		window.localStorage.setItem(HUB_THEME_STORAGE_KEY, "light");

		expect(readHubThemePreference()).toBe("light");
	});

	it("saves and applies an explicit light or dark choice", () => {
		setSystemTheme("dark");

		expect(setHubThemePreference("light")).toBe("light");

		expect(readStoredHubTheme()).toBe("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("clears the saved theme and applies the system one for system", () => {
		setSystemTheme("light");
		window.localStorage.setItem(HUB_THEME_STORAGE_KEY, "dark");
		syncHubTheme();

		expect(setHubThemePreference("system")).toBe("system");

		expect(readStoredHubTheme()).toBeNull();
		expect(document.documentElement.dataset.clineHubTheme).toBe("light");
	});

	it("follows OS changes again after switching back to system", () => {
		let systemTheme: "light" | "dark" = "light";
		const listeners = new Set<() => void>();
		window.matchMedia = ((query: string) =>
			({
				get matches() {
					return query === `(prefers-color-scheme: ${systemTheme})`;
				},
				media: query,
				addEventListener: (_type: string, listener: () => void) =>
					listeners.add(listener),
				removeEventListener: (_type: string, listener: () => void) =>
					listeners.delete(listener),
			}) as unknown as MediaQueryList) as typeof window.matchMedia;
		const changeSystemTheme = (next: "light" | "dark") => {
			systemTheme = next;
			for (const listener of listeners) listener();
		};
		// No callback, matching how the app shell calls it.
		const stopWatching = watchSystemHubTheme();

		setHubThemePreference("light");
		changeSystemTheme("dark");
		expect(document.documentElement.dataset.clineHubTheme).toBe("light");

		setHubThemePreference("system");
		expect(document.documentElement.dataset.clineHubTheme).toBe("dark");
		changeSystemTheme("light");
		expect(document.documentElement.dataset.clineHubTheme).toBe("light");

		stopWatching();
	});
});

describe("hub accent", () => {
	it("defaults to violet and validates stored values", () => {
		expect(readStoredHubAccent()).toBe(DEFAULT_HUB_ACCENT);
		window.localStorage.setItem(HUB_ACCENT_STORAGE_KEY, "not-a-color");
		expect(readStoredHubAccent()).toBe(DEFAULT_HUB_ACCENT);
		expect(isHubAccent("ember")).toBe(true);
		expect(isHubAccent("magenta")).toBe(false);
	});

	it("round-trips through storage and the html dataset", () => {
		setStoredHubAccent("graphite");
		expect(window.localStorage.getItem(HUB_ACCENT_STORAGE_KEY)).toBe(
			"graphite",
		);
		expect(document.documentElement.dataset.clineAccent).toBe("graphite");

		expect(syncHubAccent()).toBe("graphite");
		expect(document.documentElement.dataset.clineAccent).toBe("graphite");
	});

	it("clears the dataset attribute for the default accent", () => {
		applyHubAccent("ember");
		expect(document.documentElement.dataset.clineAccent).toBe("ember");
		applyHubAccent(DEFAULT_HUB_ACCENT);
		expect(document.documentElement.dataset.clineAccent).toBeUndefined();
	});
});
