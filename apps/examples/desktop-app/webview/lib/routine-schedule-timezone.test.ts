import { describe, expect, it } from "vitest";
import { routineScheduleTimezone } from "./routine-schedule-timezone";

describe("routine schedule timezone", () => {
	it("preserves an absent timezone when editing an existing recurring schedule", () => {
		expect(routineScheduleTimezone("daily", {})).toBeUndefined();
		expect(routineScheduleTimezone("weekly", {})).toBeUndefined();
	});
	it("defaults only new recurring schedules to the desktop timezone", () => {
		const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
		expect(routineScheduleTimezone("daily", null)).toBe(local);
		expect(routineScheduleTimezone("weekly", null)).toBe(local);
	});
	it("preserves explicit zones and excludes timezone for one-time schedules", () => {
		expect(routineScheduleTimezone("daily", { timezone: "Asia/Tokyo" })).toBe(
			"Asia/Tokyo",
		);
		expect(
			routineScheduleTimezone("once", { timezone: "Asia/Tokyo" }),
		).toBeUndefined();
		expect(routineScheduleTimezone("once", null)).toBeUndefined();
	});
});
