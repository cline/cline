import { describe, expect, it } from "vitest";
import { getModeAccent, getSuccessColor, getTerminalTheme } from "./palette";

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
	it("preserves the existing named ANSI colors for dark terminals", () => {
		expect(getModeAccent("act", "dark")).toBe("cyan");
		expect(getModeAccent("plan", "dark")).toBe("yellow");
		expect(getSuccessColor("dark")).toBe("brightGreen");
	});

	it("uses darker accents on light terminals", () => {
		expect(getModeAccent("act", "light")).toBe("#0969da");
		expect(getModeAccent("plan", "light")).toBe("#9a6700");
		expect(getSuccessColor("light")).toBe("#116329");
	});
});
