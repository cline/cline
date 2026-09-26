import { describe, expect, it } from "vitest";
import { getNextCronTime } from "./scheduler";

describe("hub scheduler cron helpers", () => {
	it("computes the next matching cron timestamp", () => {
		const after = new Date(2026, 3, 21, 10, 3, 12).getTime();
		const next = getNextCronTime("*/15 * * * *", after);
		expect(next).toBe(new Date(2026, 3, 21, 10, 15, 0).getTime());
	});

	it("computes the next matching cron timestamp in an explicit timezone", () => {
		const after = Date.parse("2026-04-21T15:30:00.000Z");
		const next = getNextCronTime("0 9 * * *", after, "America/New_York");
		expect(next).toBe(Date.parse("2026-04-22T13:00:00.000Z"));
	});

	// Standard cron: when both day-of-month and day-of-week are restricted, a
	// day matches if EITHER field matches ("0 9 1 * 1" = the 1st and every Monday).
	it("matches day-of-month or day-of-week when both are restricted", () => {
		// Tuesday 2026-09-01 10:00 local; the next Monday is 2026-09-07.
		const after = new Date(2026, 8, 1, 10, 0, 0).getTime();
		expect(getNextCronTime("0 9 1 * 1", after)).toBe(
			new Date(2026, 8, 7, 9, 0, 0).getTime(),
		);
		// Tuesday 2026-09-29; Thursday 1 October comes before the next Monday.
		const lateMonth = new Date(2026, 8, 29, 10, 0, 0).getTime();
		expect(getNextCronTime("0 9 1 * 1", lateMonth)).toBe(
			new Date(2026, 9, 1, 9, 0, 0).getTime(),
		);
	});

	it("matches day-of-month or day-of-week in an explicit timezone", () => {
		// Tuesday 2026-09-01 12:00 UTC; the next Monday 09:00 UTC is 2026-09-07.
		const after = Date.parse("2026-09-01T12:00:00.000Z");
		expect(getNextCronTime("0 9 1 * 1", after, "UTC")).toBe(
			Date.parse("2026-09-07T09:00:00.000Z"),
		);
	});

	it("keeps requiring both day fields when one of them is a wildcard", () => {
		// Tuesday 2026-09-01 10:00 local; a wildcard day field does not widen the match.
		const after = new Date(2026, 8, 1, 10, 0, 0).getTime();
		expect(getNextCronTime("0 9 * * 1", after)).toBe(
			new Date(2026, 8, 7, 9, 0, 0).getTime(),
		);
		expect(getNextCronTime("0 9 1 * *", after)).toBe(
			new Date(2026, 9, 1, 9, 0, 0).getTime(),
		);
	});
});
