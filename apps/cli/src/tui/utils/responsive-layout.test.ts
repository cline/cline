import { describe, expect, it } from "vitest";
import {
	fitStatusRow,
	getHomeShortcutHint,
	truncateToWidth,
} from "./responsive-layout";

describe("truncateToWidth", () => {
	it("keeps text inside the requested width", () => {
		expect(truncateToWidth("workspace", 9)).toBe("workspace");
		expect(truncateToWidth("workspace", 6)).toBe("works…");
		expect(truncateToWidth("workspace", 1)).toBe("…");
		expect(truncateToWidth("workspace", 0)).toBe("");
	});
});

describe("fitStatusRow", () => {
	it("reserves room for a right-aligned status when both sides fit", () => {
		expect(fitStatusRow(60, 20)).toEqual({
			leftWidth: 39,
			showRight: true,
		});
	});

	it("gives the full row to primary content on narrow terminals", () => {
		expect(fitStatusRow(12, 9, 6)).toEqual({
			leftWidth: 12,
			showRight: false,
		});
	});
});

describe("getHomeShortcutHint", () => {
	it("uses concise hints and never exceeds the content width", () => {
		expect(getHomeShortcutHint(60)).toBe("/ commands  @ files  Ctrl+P menu");
		expect(getHomeShortcutHint(24)).toBe("/ commands  @ files");
		expect(getHomeShortcutHint(10)).toHaveLength(10);
	});
});
