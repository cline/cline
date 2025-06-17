// npx vitest src/utils/__tests__/format.spec.ts

import { formatDate } from "../format"

describe("formatDate", () => {
	it("formats a timestamp correctly", () => {
		// January 15, 2023, 10:30 AM
		const timestamp = new Date(2023, 0, 15, 10, 30).getTime()
		const result = formatDate(timestamp)

		expect(result).toBe("JANUARY 15, 10:30 AM")
	})

	it("handles different months correctly", () => {
		// February 28, 2023, 3:45 PM
		const timestamp1 = new Date(2023, 1, 28, 15, 45).getTime()
		expect(formatDate(timestamp1)).toBe("FEBRUARY 28, 3:45 PM")

		// December 31, 2023, 11:59 PM
		const timestamp2 = new Date(2023, 11, 31, 23, 59).getTime()
		expect(formatDate(timestamp2)).toBe("DECEMBER 31, 11:59 PM")
	})

	it("handles AM/PM correctly", () => {
		// Morning time - 7:05 AM
		const morningTimestamp = new Date(2023, 5, 15, 7, 5).getTime()
		expect(formatDate(morningTimestamp)).toBe("JUNE 15, 7:05 AM")

		// Noon - 12:00 PM
		const noonTimestamp = new Date(2023, 5, 15, 12, 0).getTime()
		expect(formatDate(noonTimestamp)).toBe("JUNE 15, 12:00 PM")

		// Evening time - 8:15 PM
		const eveningTimestamp = new Date(2023, 5, 15, 20, 15).getTime()
		expect(formatDate(eveningTimestamp)).toBe("JUNE 15, 8:15 PM")
	})

	it("handles single-digit minutes with leading zeros", () => {
		// 9:05 AM
		const timestamp = new Date(2023, 3, 10, 9, 5).getTime()
		expect(formatDate(timestamp)).toBe("APRIL 10, 9:05 AM")
	})

	it("converts the result to uppercase", () => {
		const timestamp = new Date(2023, 8, 21, 16, 45).getTime()
		const result = formatDate(timestamp)

		expect(result).toBe(result.toUpperCase())
		expect(result).toBe("SEPTEMBER 21, 4:45 PM")
	})
})
