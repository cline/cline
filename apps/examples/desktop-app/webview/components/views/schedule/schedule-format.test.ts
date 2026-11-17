import { ONE_TIME_SCHEDULE_CRON_PATTERN } from "@cline/shared/browser";
import { describe, expect, it } from "vitest";
import {
	expandCronDays,
	hasCustomScheduleTiming,
	parseCronPattern,
} from "./schedule-format";

describe("custom schedule timing", () => {
	it.each([
		ONE_TIME_SCHEDULE_CRON_PATTERN,
		"0 9 * * *",
		"59 23 * * *",
		" 05 09 * * MON,WED,FRI ",
		"0 9 * * MON-FRI",
		"0 9 * * 1-5",
		"0 9 * * SUN-MON",
		"0 9 * * 0,7",
		"0 9 * * 6-7",
	])("recognizes timing represented by the controls: %s", (cron) => {
		expect(hasCustomScheduleTiming(cron)).toBe(false);
	});

	it.each([
		"0 9 1 * *",
		"0 9 * JUN MON",
		"*/15 9 * * *",
		"0 */2 * * *",
		"0,30 9 * * MON",
		"0 9,17 * * MON",
		"0 9 * * MON-FRI/2",
		"0 9 * * MON#2",
		"0 9 * * MON,INVALID",
		"0 9 * * MON,,FRI",
		"0 9 * * 8",
		"0 9 * * FRI-MON",
		"60 9 * * *",
		"0 24 * * *",
		"-1 9 * * *",
		"0 0 9 * * *",
		"0 9 * *",
		"@daily",
		"",
	])("keeps a warning for custom or unsupported timing: %s", (cron) => {
		expect(hasCustomScheduleTiming(cron)).toBe(true);
	});
});

describe("cron weekday expansion", () => {
	it.each<[string, string[]]>([
		["MON-FRI", ["MON", "TUE", "WED", "THU", "FRI"]],
		["1-5", ["MON", "TUE", "WED", "THU", "FRI"]],
		["SUN-MON", ["MON", "SUN"]],
		["6-7", ["SAT", "SUN"]],
		["0,7,SUN", ["SUN"]],
		["fri,1,WED,1", ["MON", "WED", "FRI"]],
	])("expands %s into the correct selected days", (expression, days) => {
		expect(expandCronDays(expression)).toEqual(days);
	});

	it.each([
		"MON-SUN",
		"5-1",
		"MON,8",
		"MON,",
		"MON,,FRI",
		"MON,INVALID",
	])("rejects unsupported expressions completely: %s", (expression) => {
		expect(expandCronDays(expression)).toEqual([]);
	});

	it("uses numeric weekdays in the editor instead of the fallback weekdays", () => {
		expect(parseCronPattern("30 17 * * 0,2,4")).toEqual({
			scheduleType: "weekly",
			scheduleHour: "17",
			scheduleMinute: "30",
			scheduleDays: ["TUE", "THU", "SUN"],
		});
	});

	it("retains the editor fallback for custom timing", () => {
		expect(parseCronPattern("*/15 * * * MON#2")).toEqual({
			scheduleType: "weekly",
			scheduleHour: "9",
			scheduleMinute: "0",
			scheduleDays: ["MON", "TUE", "WED", "THU", "FRI"],
		});
	});
});
