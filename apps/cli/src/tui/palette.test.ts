import { describe, expect, it } from "vitest";
import {
	getModeAccent,
	getSuccessColor,
	getTerminalTheme,
	resolveTerminalColors,
} from "./palette";

describe("getTerminalTheme", () => {
	it("detects light terminals from the default background", () => {
		expect(getTerminalTheme("#ffffff")).toBe("light");
		expect(getTerminalTheme("#fdf6e3")).toBe("light");
	});

	it("detects dark terminals from the default background", () => {
		expect(getTerminalTheme("#000000")).toBe("dark");
		expect(getTerminalTheme("#002b36")).toBe("dark");
	});

	it("uses the foreground as a fallback when background is unavailable", () => {
		expect(getTerminalTheme(null, "#1a1a1a")).toBe("light");
		expect(getTerminalTheme(null, "#f0f0f0")).toBe("dark");
	});

	it("defaults to the existing dark theme when detection is unavailable", () => {
		expect(getTerminalTheme(null, null)).toBe("dark");
	});
});

describe("resolveTerminalColors", () => {
	it("passes detected colors through when no theme is forced", () => {
		expect(resolveTerminalColors("#f2f7fb", "#2c3a4d", undefined)).toEqual({
			background: "#f2f7fb",
			foreground: "#2c3a4d",
		});
	});

	it("passes detected colors through for the auto/unknown values", () => {
		expect(resolveTerminalColors("#f2f7fb", "#2c3a4d", "auto")).toEqual({
			background: "#f2f7fb",
			foreground: "#2c3a4d",
		});
		expect(resolveTerminalColors("#f2f7fb", "#2c3a4d", "  ")).toEqual({
			background: "#f2f7fb",
			foreground: "#2c3a4d",
		});
	});

	it("forces a dark scheme (and classifies as dark) when dark is requested", () => {
		const colors = resolveTerminalColors("#f2f7fb", "#2c3a4d", "dark");
		expect(colors).toEqual({ background: "#000000", foreground: "#f0f0f0" });
		expect(getTerminalTheme(colors.background)).toBe("dark");
	});

	it("forces a light scheme (and classifies as light) when light is requested", () => {
		const colors = resolveTerminalColors("#000000", "#f0f0f0", "light");
		expect(colors).toEqual({ background: "#ffffff", foreground: "#1a1a1a" });
		expect(getTerminalTheme(colors.background)).toBe("light");
	});

	it("matches the forced theme case-insensitively", () => {
		expect(resolveTerminalColors(null, null, "DARK")).toEqual({
			background: "#000000",
			foreground: "#f0f0f0",
		});
	});
});

describe("theme-aware palette helpers", () => {
	it("uses the brand accent colors for dark terminals", () => {
		expect(getModeAccent("act", "dark")).toBe("#79b8ff");
		expect(getModeAccent("plan", "dark")).toBe("#ffea7f");
		expect(getSuccessColor("dark")).toBe("#99e89b");
	});

	it("uses darker accents on light terminals", () => {
		expect(getModeAccent("act", "light")).toBe("#0f72cb");
		expect(getModeAccent("plan", "light")).toBe("#867100");
		expect(getSuccessColor("light")).toBe("#116329");
	});
});
