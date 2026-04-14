import { describe, expect, it } from "vitest";
import { assertValidCronPattern, getNextCronRun } from "./cron";

describe("assertValidCronPattern", () => {
	it("accepts basic numeric patterns", () => {
		expect(() => assertValidCronPattern("* * * * *")).not.toThrow();
		expect(() => assertValidCronPattern("0 9 1 1 0")).not.toThrow();
		expect(() =>
			assertValidCronPattern("*/15 0-23 1-31 1-12 0-6"),
		).not.toThrow();
	});

	it("accepts weekday name ranges (MON-FRI)", () => {
		expect(() => assertValidCronPattern("0 9 * * MON-FRI")).not.toThrow();
	});

	it("accepts weekday name lists (MON,WED,FRI)", () => {
		expect(() => assertValidCronPattern("0 9 * * MON,WED,FRI")).not.toThrow();
	});

	it("accepts single weekday names", () => {
		expect(() => assertValidCronPattern("0 9 * * MON")).not.toThrow();
		expect(() => assertValidCronPattern("0 9 * * SUN")).not.toThrow();
	});

	it("accepts month name ranges (JAN-MAR)", () => {
		expect(() => assertValidCronPattern("0 9 * JAN-MAR *")).not.toThrow();
	});

	it("accepts month name lists (JAN,MAR,MAY)", () => {
		expect(() => assertValidCronPattern("0 9 * JAN,MAR,MAY *")).not.toThrow();
	});

	it("accepts lowercase and mixed-case names", () => {
		expect(() => assertValidCronPattern("0 9 * * mon-fri")).not.toThrow();
		expect(() => assertValidCronPattern("0 9 * jan-mar *")).not.toThrow();
		expect(() => assertValidCronPattern("0 9 * Jan,Mar *")).not.toThrow();
	});

	it("accepts combined name ranges with steps", () => {
		expect(() => assertValidCronPattern("*/15 * * * MON-FRI")).not.toThrow();
	});

	it("rejects invalid patterns", () => {
		expect(() => assertValidCronPattern("bad")).toThrow();
		expect(() => assertValidCronPattern("0 9 * * INVALID")).toThrow();
		expect(() => assertValidCronPattern("60 9 * * *")).toThrow();
	});
});

describe("getNextCronRun", () => {
	it("resolves next weekday for MON-FRI range", () => {
		// Use a local-time Monday at 08:00
		const from = new Date(2026, 3, 13, 8, 0, 0); // 2026-04-13 Mon local
		const next = getNextCronRun("0 9 * * MON-FRI", from);
		const date = new Date(next);
		expect(date.getHours()).toBe(9);
		expect(date.getMinutes()).toBe(0);
		// Should be the same Monday (day 1)
		expect(date.getDay()).toBe(1);
	});

	it("skips weekends for MON-FRI", () => {
		// 2026-04-18 is a Saturday, local time
		const from = new Date(2026, 3, 18, 10, 0, 0);
		const next = getNextCronRun("0 9 * * MON-FRI", from);
		const date = new Date(next);
		// Should land on Monday (day 1), April 20
		expect(date.getDay()).toBe(1);
		expect(date.getDate()).toBe(20);
	});

	it("resolves next run for month name range JAN-MAR", () => {
		// Starting in April, next JAN-MAR match is January next year
		const from = new Date(2026, 3, 13, 0, 0, 0);
		const next = getNextCronRun("0 0 1 JAN-MAR *", from);
		const date = new Date(next);
		expect(date.getMonth()).toBe(0); // January
		expect(date.getFullYear()).toBe(2027);
	});

	it("resolves next run for weekday name list MON,WED,FRI", () => {
		// 2026-04-13 is a Monday, start after 9:00 so Mon is past
		const from = new Date(2026, 3, 13, 9, 1, 0);
		const next = getNextCronRun("0 9 * * MON,WED,FRI", from);
		const date = new Date(next);
		// Next match after Mon 9:01 is Wed at 9:00
		expect(date.getDay()).toBe(3); // Wednesday
		expect(date.getHours()).toBe(9);
	});
});
