import { formatLargeNumber, formatDate, formatTimeAgo } from "../format"

// Mock i18next
vi.mock("i18next", () => ({
	default: {
		t: vi.fn((key: string, options?: any) => {
			// Mock translations for testing
			const translations: Record<string, string> = {
				"common:number_format.billion_suffix": "b",
				"common:number_format.million_suffix": "m",
				"common:number_format.thousand_suffix": "k",
				"common:time_ago.just_now": "just now",
				"common:time_ago.seconds_ago": "{{count}} seconds ago",
				"common:time_ago.minute_ago": "a minute ago",
				"common:time_ago.minutes_ago": "{{count}} minutes ago",
				"common:time_ago.hour_ago": "an hour ago",
				"common:time_ago.hours_ago": "{{count}} hours ago",
				"common:time_ago.day_ago": "a day ago",
				"common:time_ago.days_ago": "{{count}} days ago",
				"common:time_ago.week_ago": "a week ago",
				"common:time_ago.weeks_ago": "{{count}} weeks ago",
				"common:time_ago.month_ago": "a month ago",
				"common:time_ago.months_ago": "{{count}} months ago",
				"common:time_ago.year_ago": "a year ago",
				"common:time_ago.years_ago": "{{count}} years ago",
			}

			let result = translations[key] || key
			if (options?.count !== undefined) {
				result = result.replace("{{count}}", options.count.toString())
			}
			return result
		}),
		language: "en",
	},
}))

describe("formatLargeNumber", () => {
	it("should format billions", () => {
		expect(formatLargeNumber(1500000000)).toBe("1.5b")
		expect(formatLargeNumber(2000000000)).toBe("2.0b")
	})

	it("should format millions", () => {
		expect(formatLargeNumber(1500000)).toBe("1.5m")
		expect(formatLargeNumber(2000000)).toBe("2.0m")
	})

	it("should format thousands", () => {
		expect(formatLargeNumber(1500)).toBe("1.5k")
		expect(formatLargeNumber(2000)).toBe("2.0k")
	})

	it("should return string for small numbers", () => {
		expect(formatLargeNumber(999)).toBe("999")
		expect(formatLargeNumber(100)).toBe("100")
	})
})

describe("formatDate", () => {
	it("should format date in English", () => {
		const timestamp = new Date("2024-01-15T14:30:00").getTime()
		const result = formatDate(timestamp)
		// The exact format depends on the locale, but it should contain the date components
		expect(result).toMatch(/january|jan/i)
		expect(result).toMatch(/15/)
	})
})

describe("formatTimeAgo", () => {
	let originalDateNow: () => number

	beforeEach(() => {
		// Mock Date.now to have a consistent "now" time
		originalDateNow = Date.now
		Date.now = vi.fn(() => new Date("2024-01-15T12:00:00").getTime())
	})

	afterEach(() => {
		// Restore original Date.now
		Date.now = originalDateNow
	})

	it('should return "just now" for very recent times', () => {
		const timestamp = new Date("2024-01-15T11:59:35").getTime() // 25 seconds ago
		expect(formatTimeAgo(timestamp)).toBe("just now")
	})

	it("should format seconds ago", () => {
		const timestamp = new Date("2024-01-15T11:59:15").getTime() // 45 seconds ago
		expect(formatTimeAgo(timestamp)).toBe("45 seconds ago")
	})

	it("should format a minute ago", () => {
		const timestamp = new Date("2024-01-15T11:59:00").getTime() // 1 minute ago
		expect(formatTimeAgo(timestamp)).toBe("a minute ago")
	})

	it("should format minutes ago", () => {
		const timestamp = new Date("2024-01-15T11:45:00").getTime() // 15 minutes ago
		expect(formatTimeAgo(timestamp)).toBe("15 minutes ago")
	})

	it("should format an hour ago", () => {
		const timestamp = new Date("2024-01-15T11:00:00").getTime() // 1 hour ago
		expect(formatTimeAgo(timestamp)).toBe("an hour ago")
	})

	it("should format hours ago", () => {
		const timestamp = new Date("2024-01-15T09:00:00").getTime() // 3 hours ago
		expect(formatTimeAgo(timestamp)).toBe("3 hours ago")
	})

	it("should format a day ago", () => {
		const timestamp = new Date("2024-01-14T12:00:00").getTime() // 1 day ago
		expect(formatTimeAgo(timestamp)).toBe("a day ago")
	})

	it("should format days ago", () => {
		const timestamp = new Date("2024-01-12T12:00:00").getTime() // 3 days ago
		expect(formatTimeAgo(timestamp)).toBe("3 days ago")
	})

	it("should format a week ago", () => {
		const timestamp = new Date("2024-01-08T12:00:00").getTime() // 7 days ago
		expect(formatTimeAgo(timestamp)).toBe("a week ago")
	})

	it("should format weeks ago", () => {
		const timestamp = new Date("2024-01-01T12:00:00").getTime() // 14 days ago
		expect(formatTimeAgo(timestamp)).toBe("2 weeks ago")
	})

	it("should format a month ago", () => {
		const timestamp = new Date("2023-12-15T12:00:00").getTime() // ~1 month ago
		expect(formatTimeAgo(timestamp)).toBe("a month ago")
	})

	it("should format months ago", () => {
		const timestamp = new Date("2023-10-15T12:00:00").getTime() // ~3 months ago
		expect(formatTimeAgo(timestamp)).toBe("3 months ago")
	})

	it("should format a year ago", () => {
		const timestamp = new Date("2023-01-15T12:00:00").getTime() // 1 year ago
		expect(formatTimeAgo(timestamp)).toBe("a year ago")
	})

	it("should format years ago", () => {
		const timestamp = new Date("2021-01-15T12:00:00").getTime() // 3 years ago
		expect(formatTimeAgo(timestamp)).toBe("3 years ago")
	})
})
