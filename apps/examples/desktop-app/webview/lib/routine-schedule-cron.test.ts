import { describe, expect, it } from "vitest";
import { preserveRoutineCron } from "./routine-schedule-cron";

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
