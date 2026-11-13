import { describe, expect, it } from "vitest";
import { expandCronDays, preserveRoutineCron } from "./routine-schedule-cron";

const daily = {
	scheduleType: "daily",
	scheduleHour: "9",
	scheduleMinute: "0",
	scheduleDays: ["MON"],
};
describe("routine cron editing", () => {
	it.each([
		"0 */2 * * *",
		"0 9 1 * *",
		"0 9 * 6 *",
	])("preserves %s on unrelated edits", (cron) => {
		expect(preserveRoutineCron(cron, daily, { ...daily }, "0 9 * * *")).toBe(
			cron,
		);
	});
	it("replaces cron when the user changes timing", () => {
		expect(
			preserveRoutineCron(
				"0 9 1 * *",
				daily,
				{ ...daily, scheduleHour: "10" },
				"0 10 * * *",
			),
		).toBe("0 10 * * *");
		expect(
			preserveRoutineCron(
				"0 9 1 * *",
				daily,
				{ ...daily, scheduleType: "once" },
				undefined,
			),
		).toBeUndefined();
	});
	it("compares weekly days without depending on selection order", () => {
		const weekly = {
			...daily,
			scheduleType: "weekly",
			scheduleDays: ["MON", "FRI"],
		};
		expect(
			preserveRoutineCron(
				"0 9 * * 1,5",
				weekly,
				{ ...weekly, scheduleDays: ["FRI", "MON"] },
				"replacement",
			),
		).toBe("0 9 * * 1,5");
		expect(
			preserveRoutineCron(
				"0 9 * * 1,5",
				weekly,
				{ ...weekly, scheduleDays: ["MON"] },
				"0 9 * * 1",
			),
		).toBe("0 9 * * 1");
	});
});

describe("expandCronDays", () => {
	it.each([
		["*", ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]],
		["MON-FRI", ["MON", "TUE", "WED", "THU", "FRI"]],
		["fri,mon", ["MON", "FRI"]],
		["SUN-TUE", ["MON", "TUE", "SUN"]],
	])("reads day names in %s", (field, days) => {
		expect(expandCronDays(field)).toEqual(days);
	});

	it.each([
		["1", ["MON"]],
		["0", ["SUN"]],
		["1-5", ["MON", "TUE", "WED", "THU", "FRI"]],
		["6,0", ["SAT", "SUN"]],
		["1,3,5", ["MON", "WED", "FRI"]],
		["*/2", ["TUE", "THU", "SAT", "SUN"]],
		["1-5/2", ["MON", "WED", "FRI"]],
		["MON,6", ["MON", "SAT"]],
	])("reads numeric days in %s like the scheduler does", (field, days) => {
		expect(expandCronDays(field)).toEqual(days);
	});

	it.each([
		"7",
		"8",
		"FRI-MON",
		"5-1",
		"*/0",
		"1-x",
	])("ignores %s, which the scheduler rejects", (field) => {
		expect(expandCronDays(field)).toEqual([]);
	});
});
