import { describe, expect, it } from "vitest"

import { translateModifyOtherKeys } from "./enhanced-stdin"

describe("translateModifyOtherKeys", () => {
	// Modifier encoding: value = bits + 1
	// modifier 2 = Shift, 3 = Alt, 4 = Shift+Alt, 5 = Ctrl, 6 = Shift+Ctrl, 7 = Alt+Ctrl

	describe("Alt+Backspace (word delete)", () => {
		it("returns null for Alt+Backspace (modifyOtherKeys: mod=3, key=127)", () => {
			// \x1b[27;3;127~ — iTerm2 with modifyOtherKeys level 2
			expect(translateModifyOtherKeys(3, 127)).toBeNull()
		})

		it("returns null for Alt+Backspace (Kitty: key=127, mod=3)", () => {
			// \x1b[127;3u — Kitty keyboard protocol
			expect(translateModifyOtherKeys(3, 127)).toBeNull()
		})
	})

	describe("Ctrl+Backspace (word delete)", () => {
		it("returns null for Ctrl+Backspace (Kitty: key=127, mod=5)", () => {
			// \x1b[127;5u — VSCode terminal via Kitty protocol
			expect(translateModifyOtherKeys(5, 127)).toBeNull()
		})

		it("returns null for Ctrl+Alt+Backspace (mod=7, key=127)", () => {
			expect(translateModifyOtherKeys(7, 127)).toBeNull()
		})
	})

	describe("Ctrl+letter translation", () => {
		it("translates Ctrl+C (mod=5, key=99) to \\x03", () => {
			expect(translateModifyOtherKeys(5, 99)).toBe("\x03")
		})

		it("translates Ctrl+D (mod=5, key=100) to \\x04", () => {
			expect(translateModifyOtherKeys(5, 100)).toBe("\x04")
		})

		it("translates Ctrl+Z (mod=5, key=122) to \\x1a", () => {
			expect(translateModifyOtherKeys(5, 122)).toBe("\x1a")
		})

		it("translates Ctrl+A (mod=5, key=65) to \\x01", () => {
			expect(translateModifyOtherKeys(5, 65)).toBe("\x01")
		})

		it("translates Ctrl+W (mod=5, key=119) to \\x17", () => {
			// Ctrl+W = word delete (traditional)
			expect(translateModifyOtherKeys(5, 119)).toBe("\x17")
		})
	})

	describe("Alt+letter translation (Meta prefix)", () => {
		it("translates Alt+b (mod=3, key=98) to ESC+b", () => {
			// Option+Left sends \x1bb in many terminals
			expect(translateModifyOtherKeys(3, 98)).toBe("\x1bb")
		})

		it("translates Alt+f (mod=3, key=102) to ESC+f", () => {
			// Option+Right sends \x1bf in many terminals
			expect(translateModifyOtherKeys(3, 102)).toBe("\x1bf")
		})

		it("translates Alt+d (mod=3, key=100) to ESC+d", () => {
			expect(translateModifyOtherKeys(3, 100)).toBe("\x1bd")
		})
	})

	describe("Alt+Ctrl+letter translation", () => {
		it("translates Alt+Ctrl+C (mod=7, key=99) to ESC+\\x03", () => {
			expect(translateModifyOtherKeys(7, 99)).toBe("\x1b\x03")
		})
	})

	describe("Shift-only (passthrough)", () => {
		it("translates Shift+A (mod=2, key=65) to 'A'", () => {
			// Shift alone: no alt, no ctrl — just pass through keycode
			expect(translateModifyOtherKeys(2, 65)).toBe("A")
		})
	})

	describe("edge cases", () => {
		it("handles Tab keycode (mod=5, key=9) — Ctrl+Tab", () => {
			// keycode 9 < 64, so doesn't hit the Ctrl+letter branch
			expect(translateModifyOtherKeys(5, 9)).toBe("\t")
		})

		it("handles Enter keycode (mod=3, key=13) — Alt+Enter", () => {
			// keycode 13 < 64, alt+key where key isn't in letter range
			expect(translateModifyOtherKeys(3, 13)).toBe("\x1b\r")
		})
	})
})
