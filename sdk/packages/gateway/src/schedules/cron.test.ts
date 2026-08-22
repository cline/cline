import { describe, expect, it } from "vitest";
import { nextCronDueAt, parseCronPattern } from "./cron";

describe("Gateway routine cron", () => {
	it("computes the next selected local weekday", () => {
		const monday = new Date(2026, 7, 17, 8, 30, 0, 0);
		const next = new Date(
			nextCronDueAt("0 9 * * MON,WED,FRI", monday.getTime()),
		);
		expect(next.getDay()).toBe(1);
		expect(next.getHours()).toBe(9);
		expect(next.getMinutes()).toBe(0);
	});

	it("moves past today's firing and accepts weekday ranges", () => {
		const mondayAfter = new Date(2026, 7, 17, 9, 1, 0, 0);
		const next = new Date(
			nextCronDueAt("0 9 * * MON-FRI", mondayAfter.getTime()),
		);
		expect(next.getDay()).toBe(2);
		expect(next.getHours()).toBe(9);
	});

	it("rejects grammar outside the desktop routine surface", () => {
		expect(() => parseCronPattern("*/5 * * * *")).toThrow("integer");
		expect(() => parseCronPattern("0 9 * * FUNDAY")).toThrow("Unknown");
		expect(() => parseCronPattern("0 9 1 * *")).toThrow("format");
	});
});
