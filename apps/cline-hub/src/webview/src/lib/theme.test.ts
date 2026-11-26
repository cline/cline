// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	HUB_THEME_STORAGE_KEY,
	readSystemHubTheme,
	setStoredHubTheme,
	syncHubTheme,
	watchSystemHubTheme,
} from "./theme";

afterEach(() => {
	window.localStorage.clear();
	delete document.body.dataset.vscodeThemeKind;
	document.documentElement.classList.remove("dark");
	delete document.documentElement.dataset.clineHubTheme;
	vi.unstubAllGlobals();
});

function mockSystemTheme(initialDark: boolean) {
	let dark = initialDark;
	const listeners = new Set<() => void>();
	vi.stubGlobal("matchMedia", (query: string) => ({
		get matches() {
			return query === "(prefers-color-scheme: dark)" && dark;
		},
		addEventListener: (_event: string, listener: () => void) => {
			listeners.add(listener);
		},
		removeEventListener: (_event: string, listener: () => void) => {
			listeners.delete(listener);
		},
	}));
	return (nextDark: boolean) => {
		dark = nextDark;
		for (const listener of listeners) listener();
	};
}

describe("hub theme", () => {
	it("uses the browser color scheme when no preference has been saved", () => {
		mockSystemTheme(true);

		expect(syncHubTheme()).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.dataset.clineHubTheme).toBe("dark");
	});

	it("uses light for a light browser color scheme", () => {
		mockSystemTheme(false);

		expect(readSystemHubTheme()).toBe("light");
	});

	it.each([
		["vscode-dark", "dark", false],
		["vscode-high-contrast", "dark", false],
		["vscode-light", "light", true],
		["vscode-high-contrast-light", "light", true],
	] as const)("keeps the %s host theme ahead of the browser", (kind, theme, dark) => {
		mockSystemTheme(dark);
		document.body.dataset.vscodeThemeKind = kind;

		expect(readSystemHubTheme()).toBe(theme);
	});

	it("keeps a saved preference ahead of the browser color scheme", () => {
		mockSystemTheme(true);
		window.localStorage.setItem(HUB_THEME_STORAGE_KEY, "light");

		expect(syncHubTheme()).toBe("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("follows live browser changes until an explicit preference is saved", () => {
		const changeTheme = mockSystemTheme(false);
		syncHubTheme();
		const stopWatching = watchSystemHubTheme();

		changeTheme(true);
		expect(document.documentElement.dataset.clineHubTheme).toBe("dark");

		changeTheme(false);
		expect(document.documentElement.dataset.clineHubTheme).toBe("light");

		setStoredHubTheme("dark");
		changeTheme(false);
		expect(document.documentElement.dataset.clineHubTheme).toBe("dark");
		stopWatching();
	});

	it("stops following browser changes when cleaned up", () => {
		const changeTheme = mockSystemTheme(false);
		syncHubTheme();
		const stopWatching = watchSystemHubTheme();
		stopWatching();

		changeTheme(true);

		expect(document.documentElement.dataset.clineHubTheme).toBe("light");
	});

	it("keeps the light fallback when media queries are unavailable", () => {
		vi.stubGlobal("matchMedia", undefined);

		expect(syncHubTheme()).toBe("light");
		expect(watchSystemHubTheme()).toBeTypeOf("function");
	});
});
