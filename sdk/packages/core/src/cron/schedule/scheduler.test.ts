import { describe, expect, it } from "vitest";
import { getNextCronTime, parseCron } from "./scheduler";

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

	it("accepts 7 as Sunday in the day-of-week field", () => {
		// Tuesday 2026-04-21 10:00 local; the next Sunday is 2026-04-26.
		const after = new Date(2026, 3, 21, 10, 0, 0).getTime();
		expect(getNextCronTime("0 9 * * 7", after)).toBe(
			new Date(2026, 3, 26, 9, 0, 0).getTime(),
		);
		expect(parseCron("0 9 * * 5-7").daysOfWeek).toEqual([0, 5, 6]);
	});
});
