import { formatLanguage } from "../language"

describe("formatLanguage", () => {
	it("should uppercase region code in locale string", () => {
		expect(formatLanguage("en-us")).toBe("en-US")
		expect(formatLanguage("fr-ca")).toBe("fr-CA")
		expect(formatLanguage("de-de")).toBe("de-DE")
	})

	it("should return original string if no region code present", () => {
		expect(formatLanguage("en")).toBe("en")
		expect(formatLanguage("fr")).toBe("fr")
	})

	it("should handle empty or undefined input", () => {
		expect(formatLanguage("")).toBe("en")
		expect(formatLanguage(undefined as unknown as string)).toBe("en")
	})
})
