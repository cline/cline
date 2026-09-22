// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAppLocale } from "@/lib/i18n";
import {
	APP_LOCALE_STORAGE_KEY,
	APP_LOCALES,
	readStoredLocalePreference,
} from "@/lib/locale";
import { SettingsView } from "./settings-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	isTauriAvailable: vi.fn(() => false),
	openExternalUrl: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
	disconnect() {}
	observe() {}
	unobserve() {}
}

beforeEach(() => {
	Object.assign(globalThis, {
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: ResizeObserverStub,
	});
	window.localStorage.clear();
	invoke.mockReset();
	invoke.mockResolvedValue({
		telemetryOptOut: false,
		autoUpdateEnabled: true,
	});
	// Reset the shared translator to English so tests are order-independent.
	act(() => {
		applyAppLocale("en");
	});
	window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, "en");
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

function renderGeneralSettings() {
	return act(async () => {
		root.render(<SettingsView onNavigateSection={vi.fn()} section="General" />);
	});
}

function languageSelect() {
	return container.querySelector<HTMLSelectElement>(
		'select[aria-label="Language"], select[aria-label="语言"]',
	);
}

function changeLocale(value: string) {
	const select = languageSelect();
	if (!select) {
		throw new Error("language select not rendered");
	}
	const setValue = Object.getOwnPropertyDescriptor(
		HTMLSelectElement.prototype,
		"value",
	)?.set;
	setValue?.call(select, value);
	select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("SettingsView language", () => {
	it("renders the language row with self-describing options", async () => {
		await renderGeneralSettings();

		const select = languageSelect();
		expect(select).not.toBeNull();
		const values = Array.from(select?.options ?? []).map(
			(option) => option.value,
		);
		expect(values).toEqual(["system", ...APP_LOCALES]);
		const labels = Array.from(select?.options ?? []).map(
			(option) => option.textContent,
		);
		// The system option is translated; languages name themselves.
		expect(labels).toContain("Follow system");
		expect(labels).toContain("English");
		expect(labels).toContain("简体中文");
		expect(select?.value).toBe(
			readStoredLocalePreference() === "system" ? "system" : "en",
		);
	});

	it("applies Simplified Chinese immediately and persists the choice", async () => {
		await renderGeneralSettings();

		await act(async () => {
			changeLocale("zh-Hans");
		});

		expect(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("zh-Hans");
		expect(document.documentElement.lang).toBe("zh-Hans");
		expect(document.documentElement.dataset.clineLocale).toBe("zh-Hans");
		expect(invoke).toHaveBeenCalledWith("set_language", {
			language: "zh-Hans",
		});
		// The row re-renders in the new locale straight away.
		expect(container.textContent).toContain("语言");
		expect(container.textContent).toContain("选择 Cline 桌面应用的显示语言。");
	});

	it("still applies the locale when persistence fails", async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "set_language") {
				throw new Error("disk full");
			}
			return { telemetryOptOut: false, autoUpdateEnabled: true };
		});

		await renderGeneralSettings();

		await act(async () => {
			changeLocale("zh-Hans");
		});

		expect(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("zh-Hans");
		expect(document.documentElement.lang).toBe("zh-Hans");
		expect(container.textContent).toContain("语言");
	});

	it("switching back to English restores the source labels", async () => {
		await renderGeneralSettings();

		await act(async () => {
			changeLocale("zh-Hans");
		});
		expect(container.textContent).toContain("语言");

		await act(async () => {
			changeLocale("en");
		});
		expect(container.textContent).toContain("Language");
		expect(document.documentElement.lang).toBe("en");
	});
});
