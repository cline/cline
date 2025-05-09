import { convertHeadersToObject } from "../headers"

describe("convertHeadersToObject", () => {
	it("should convert headers array to object", () => {
		const headers: [string, string][] = [
			["Content-Type", "application/json"],
			["Authorization", "Bearer token123"],
		]

		const result = convertHeadersToObject(headers)

		expect(result).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer token123",
		})
	})

	it("should trim whitespace from keys and values", () => {
		const headers: [string, string][] = [
			["  Content-Type  ", "  application/json  "],
			["  Authorization  ", "  Bearer token123  "],
		]

		const result = convertHeadersToObject(headers)

		expect(result).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer token123",
		})
	})

	it("should handle empty headers array", () => {
		const headers: [string, string][] = []

		const result = convertHeadersToObject(headers)

		expect(result).toEqual({})
	})

	it("should skip headers with empty keys", () => {
		const headers: [string, string][] = [
			["Content-Type", "application/json"],
			["", "This value should be skipped"],
			["  ", "This value should also be skipped"],
			["Authorization", "Bearer token123"],
		]

		const result = convertHeadersToObject(headers)

		expect(result).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer token123",
		})

		// Specifically verify empty keys are not present
		expect(result[""]).toBeUndefined()
		expect(result["  "]).toBeUndefined()
	})

	it("should use last occurrence when handling duplicate keys", () => {
		const headers: [string, string][] = [
			["Content-Type", "application/json"],
			["Authorization", "Bearer token123"],
			["Content-Type", "text/plain"], // Duplicate key - should override previous value
			["Content-Type", "application/xml"], // Another duplicate - should override again
		]

		const result = convertHeadersToObject(headers)

		// Verify the last value for "Content-Type" is used
		expect(result["Content-Type"]).toBe("application/xml")
		expect(result).toEqual({
			"Content-Type": "application/xml",
			Authorization: "Bearer token123",
		})
	})

	it("should preserve case sensitivity while trimming keys", () => {
		const headers: [string, string][] = [
			[" Content-Type", "application/json"],
			["content-type ", "text/plain"], // Different casing (lowercase) with spacing
		]

		const result = convertHeadersToObject(headers)

		// Keys should be trimmed but case sensitivity preserved
		// JavaScript object keys are case-sensitive
		expect(Object.keys(result)).toHaveLength(2)
		expect(result["Content-Type"]).toBe("application/json")
		expect(result["content-type"]).toBe("text/plain")
	})

	it("should handle empty values", () => {
		const headers: [string, string][] = [
			["Empty-Value", ""],
			["Whitespace-Value", "   "],
		]

		const result = convertHeadersToObject(headers)

		// Empty values should be included but trimmed
		expect(result["Empty-Value"]).toBe("")
		expect(result["Whitespace-Value"]).toBe("")
	})

	it("should handle complex duplicate key scenarios with mixed casing and spacing", () => {
		const headers: [string, string][] = [
			["content-type", "application/json"], // Original entry
			["  Content-Type  ", "text/html"], // Different case with spacing
			["content-type", "application/xml"], // Same case as first, should override it
			["Content-Type", "text/plain"], // Same case as second, should override it
		]

		const result = convertHeadersToObject(headers)

		// JavaScript object keys are case-sensitive
		// We should have two keys with different cases, each with the last value
		expect(Object.keys(result).sort()).toEqual(["Content-Type", "content-type"].sort())
		expect(result["content-type"]).toBe("application/xml")
		expect(result["Content-Type"]).toBe("text/plain")
	})
})
