// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
	HOST_APPEARANCE_EVENT,
	readHostTheme,
	syncHostAppearance,
	toAppFontSize,
} from "./host-appearance";
import { resetHostModeForTesting } from "./host-mode";

const win = window as unknown as Record<string, unknown>;

afterEach(() => {
	delete win.__CLINE_HOST_SHELL__;
	delete document.body.dataset.vscodeThemeKind;
	document.documentElement.classList.remove("dark");
	document.documentElement.style.cssText = "";
	resetHostModeForTesting();
});

describe("readHostTheme", () => {
	it("maps VS Code theme kinds", () => {
		document.body.dataset.vscodeThemeKind = "vscode-light";
		expect(readHostTheme()).toBe("light");
		document.body.dataset.vscodeThemeKind = "vscode-high-contrast";
		expect(readHostTheme()).toBe("dark");
	});
	it("is null outside VS Code", () => {
		expect(readHostTheme()).toBeNull();
	});
});

describe("toAppFontSize", () => {
	it("snaps to the nearest supported step", () => {
		expect(toAppFontSize(13)).toBe(13);
		expect(toAppFontSize(14.6)).toBe(15);
		expect(toAppFontSize(9)).toBe(12);
		expect(toAppFontSize(40)).toBe(20);
	});
});

describe("syncHostAppearance", () => {
	it("is a no-op when the host does not own appearance", () => {
		document.body.dataset.vscodeThemeKind = "vscode-light";
		document.documentElement.classList.add("dark");
		const stop = syncHostAppearance();
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		stop();
	});

	it("applies and follows the VS Code theme", async () => {
		win.__CLINE_HOST_SHELL__ = { kind: "vscode", commands: [] };
		document.body.dataset.vscodeThemeKind = "vscode-light";
		document.documentElement.classList.add("dark");
		const stop = syncHostAppearance();
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		document.body.dataset.vscodeThemeKind = "vscode-dark";
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		stop();
	});

	it("prefers the host's mirror element and its change event", () => {
		win.__CLINE_HOST_SHELL__ = { kind: "vscode", commands: [] };
		const mirror = document.createElement("meta");
		mirror.id = "cline-host-appearance";
		mirror.dataset.themeKind = "vscode-light";
		mirror.dataset.fontSize = "13px";
		document.head.appendChild(mirror);
		document.body.dataset.vscodeThemeKind = "vscode-dark"; // stale, ignored
		const stop = syncHostAppearance();
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(document.documentElement.style.fontSize).toBe("15px");
		mirror.dataset.themeKind = "vscode-dark";
		mirror.dataset.fontSize = "18px";
		document.dispatchEvent(new Event(HOST_APPEARANCE_EVENT));
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.style.fontSize).toBe("20px");
		stop();
		mirror.remove();
	});
});
