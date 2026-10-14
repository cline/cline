import { describe, expect, it } from "vitest";
import { isAnyKeyDismiss } from "./dialog-keys";

describe("isAnyKeyDismiss", () => {
	it("treats ordinary unmodified keys as a dismiss", () => {
		for (const name of ["escape", "q", "x", "return", "space", "up"]) {
			expect(isAnyKeyDismiss({ name })).toBe(true);
		}
	});

	it("treats Shift- and Option-held keys as a dismiss (ordinary typed chars)", () => {
		expect(isAnyKeyDismiss({ name: "x", shift: true } as never)).toBe(true);
		expect(isAnyKeyDismiss({ name: "x", option: true } as never)).toBe(true);
	});

	it("does not treat link-click / shortcut modifiers as a dismiss", () => {
		expect(isAnyKeyDismiss({ name: "x", ctrl: true })).toBe(false);
		expect(isAnyKeyDismiss({ name: "x", meta: true })).toBe(false);
		expect(isAnyKeyDismiss({ name: "x", super: true })).toBe(false);
		expect(isAnyKeyDismiss({ name: "x", hyper: true })).toBe(false);
	});

	it("ignores bare modifier presses with no key name", () => {
		expect(isAnyKeyDismiss({ name: "" })).toBe(false);
	});
});
