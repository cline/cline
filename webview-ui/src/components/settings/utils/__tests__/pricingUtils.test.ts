import { describe, expect, it } from "vitest"
import { parsePrice } from "../pricingUtils"

describe("pricingUtils", () => {
	describe("parsePrice", () => {
		const defaultValue = 0

		it("should parse valid decimal numbers", () => {
			expect(parsePrice("1.5", defaultValue)).toBe(1.5)
			expect(parsePrice("0.25", defaultValue)).toBe(0.25)
			expect(parsePrice("100", defaultValue)).toBe(100)
			expect(parsePrice("0", defaultValue)).toBe(0)
		})

		it("should parse decimals starting with a dot", () => {
			expect(parsePrice(".5", defaultValue)).toBe(0.5)
			expect(parsePrice(".25", defaultValue)).toBe(0.25)
			expect(parsePrice(".001", defaultValue)).toBe(0.001)
		})

		it("should return default for empty string", () => {
			expect(parsePrice("", defaultValue)).toBe(0)
			expect(parsePrice("", 5)).toBe(5)
		})

		it("should return default for just a dot", () => {
			expect(parsePrice(".", defaultValue)).toBe(0)
			expect(parsePrice(".", 3.5)).toBe(3.5)
		})

		it("should return default for invalid input", () => {
			expect(parsePrice("abc", defaultValue)).toBe(0)
			expect(parsePrice("abc", 10)).toBe(10)
			expect(parsePrice("1.2.3", defaultValue)).toBe(1.2) // parseFloat stops at second dot
		})

		it("should handle trailing zeros correctly", () => {
			expect(parsePrice("1.0", defaultValue)).toBe(1)
			expect(parsePrice("1.00", defaultValue)).toBe(1)
			expect(parsePrice("0.10", defaultValue)).toBe(0.1)
		})

		it("should handle numbers with trailing dot", () => {
			// "1." is a valid partial input that parseFloat handles as 1
			expect(parsePrice("1.", defaultValue)).toBe(1)
			expect(parsePrice("0.", defaultValue)).toBe(0)
		})

		it("should use the provided default value", () => {
			expect(parsePrice("", 99)).toBe(99)
			expect(parsePrice(".", 42)).toBe(42)
			expect(parsePrice("invalid", 7.5)).toBe(7.5)
		})
	})
})
