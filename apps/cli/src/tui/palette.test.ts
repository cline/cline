import { describe, expect, it } from "vitest";
import { getTerminalTheme, themePalette } from "./palette";

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

describe("theme-aware palette helpers", () => {
	it("uses the brand accent colors for dark terminals", () => {
		expect(themePalette.dark.act).toBe("#79b8ff");
		expect(themePalette.dark.plan).toBe("#ffea7f");
		expect(themePalette.dark.success).toBe("#99e89b");
	});

	it("uses darker accents on light terminals", () => {
		expect(themePalette.light.act).toBe("#0f72cb");
		expect(themePalette.light.plan).toBe("#867100");
		expect(themePalette.light.success).toBe("#116329");
	});
});
