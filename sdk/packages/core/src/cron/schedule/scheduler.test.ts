import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import { getNextCronTime } from "./scheduler";

const schedulerModule = `data:text/javascript;base64,${Buffer.from(
	transpileModule(
		readFileSync(new URL("./scheduler.ts", import.meta.url), "utf8"),
		{
			compilerOptions: {
				module: ModuleKind.ESNext,
				target: ScriptTarget.ES2022,
			},
		},
	).outputText,
).toString("base64")}`;

function getNextCronTimeWithHostTimezone(
	pattern: string,
	after: string,
	timezone: string | undefined,
	hostTimezone = "America/New_York",
): string {
	const script = `
		const { getNextCronTime } = await import(process.argv[1]);
		const [pattern, after, timezone] = JSON.parse(process.argv[2]);
		process.stdout.write(new Date(getNextCronTime(pattern, Date.parse(after), timezone)).toISOString());
	`;
	return execFileSync(
		process.execPath,
		[
			"--no-warnings",
			"--input-type=module",
			"-e",
			script,
			schedulerModule,
			JSON.stringify([pattern, after, timezone]),
		],
		{
			env: { ...process.env, TZ: hostTimezone },
			encoding: "utf8",
			timeout: 10_000,
		},
	);
}

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

	it.each([
		[
			"a UTC occurrence at the start of the repeated hour",
			"30 6 * * *",
			"2026-11-01T06:30:00.000Z",
			"UTC",
			"2026-11-02T06:30:00.000Z",
		],
		[
			"a UTC occurrence 15 seconds into the repeated hour",
			"30 6 * * *",
			"2026-11-01T06:30:15.000Z",
			"UTC",
			"2026-11-02T06:30:00.000Z",
		],
		[
			"a UTC occurrence 30 seconds into the repeated hour",
			"30 6 * * *",
			"2026-11-01T06:30:30.000Z",
			"UTC",
			"2026-11-02T06:30:00.000Z",
		],
		[
			"the second UTC instant for repeated 01:30 in an explicit timezone",
			"30 1 * * *",
			"2026-11-01T06:00:00.000Z",
			"America/New_York",
			"2026-11-01T06:30:00.000Z",
		],
		[
			"the second UTC instant for repeated 01:30 in the local timezone",
			"30 1 * * *",
			"2026-11-01T06:00:00.000Z",
			undefined,
			"2026-11-01T06:30:00.000Z",
		],
		[
			"a later minute in the second occurrence of a local hour",
			"30 1 * * *",
			"2026-11-01T06:01:00.000Z",
			undefined,
			"2026-11-01T06:30:00.000Z",
		],
		[
			"a repeated local hour after the first occurrence has passed",
			"30 1 * * *",
			"2026-11-01T05:45:00.000Z",
			undefined,
			"2026-11-01T06:30:00.000Z",
		],
		[
			"the start of the repeated local hour",
			"0 1 * * *",
			"2026-11-01T05:15:00.000Z",
			undefined,
			"2026-11-01T06:00:00.000Z",
		],
		[
			"a local time skipped by the spring transition",
			"30 2 * * *",
			"2026-03-08T06:55:00.000Z",
			undefined,
			"2026-03-09T06:30:00.000Z",
		],
		[
			"a weekday in the local timezone",
			"0 9 * * 1",
			"2026-04-21T15:30:00.000Z",
			undefined,
			"2026-04-27T13:00:00.000Z",
		],
	])("finds %s", (_description, pattern, after, timezone, expected) => {
		expect(getNextCronTimeWithHostTimezone(pattern, after, timezone)).toBe(
			expected,
		);
	});

	it("returns both distinct UTC instants for repeated 01:30", () => {
		const pattern = "30 1 * * *";
		const timezone = "America/New_York";
		const first = getNextCronTime(
			pattern,
			Date.parse("2026-11-01T05:00:00.000Z"),
			timezone,
		);
		const second = getNextCronTime(pattern, first, timezone);
		const following = getNextCronTime(pattern, second, timezone);

		expect(new Date(first).toISOString()).toBe("2026-11-01T05:30:00.000Z");
		expect(new Date(second).toISOString()).toBe("2026-11-01T06:30:00.000Z");
		expect(new Date(following).toISOString()).toBe("2026-11-02T06:30:00.000Z");
	});

	it.each([
		[
			"a local date ahead of UTC",
			"0 0 1 1 *",
			"2026-12-30T23:59:00.000Z",
			"Pacific/Kiritimati",
			"2026-12-31T10:00:00.000Z",
		],
		[
			"a local date behind UTC",
			"0 23 1 1 *",
			"2027-01-01T23:59:00.000Z",
			"America/Adak",
			"2027-01-02T09:00:00.000Z",
		],
		[
			"a date-line jump to the next local date",
			"0 0 31 12 *",
			"2011-12-29T10:00:00.000Z",
			"Pacific/Apia",
			"2011-12-30T10:00:00.000Z",
		],
		[
			"the next occurrence after a skipped calendar date",
			"0 0 30 12 *",
			"2011-12-29T10:00:00.000Z",
			"Pacific/Apia",
			"2012-12-29T10:00:00.000Z",
		],
		[
			"a repeated calendar day",
			"30 23 4 3 *",
			"2010-03-04T14:00:00.000Z",
			"Antarctica/Casey",
			"2010-03-04T15:30:00.000Z",
		],
	])("finds %s in an explicit timezone", (_description, pattern, after, timezone, expected) => {
		expect(
			new Date(
				getNextCronTime(pattern, Date.parse(after), timezone),
			).toISOString(),
		).toBe(expected);
	});

	it.each([
		["0 0 29 2 *", "America/New_York", "2028-02-29T05:00:00.000Z"],
		["0 9 1 1 *", "UTC", "2027-01-01T09:00:00.000Z"],
	])("bounds timezone formatting for sparse %s in %s", (pattern, timezone, expected) => {
		const formatToParts = Intl.DateTimeFormat.prototype.formatToParts;
		let calls = 0;
		Intl.DateTimeFormat.prototype.formatToParts = function (date) {
			calls += 1;
			if (calls > 8_000) throw new Error("Too many timezone formatting calls");
			return formatToParts.call(this, date);
		};
		try {
			const next = getNextCronTime(
				pattern,
				Date.parse("2026-03-01T00:00:00.000Z"),
				timezone,
			);
			expect(new Date(next).toISOString()).toBe(expected);
		} finally {
			Intl.DateTimeFormat.prototype.formatToParts = formatToParts;
		}
	});

	it("uses a local timezone with a fractional-hour offset", () => {
		expect(
			getNextCronTimeWithHostTimezone(
				"0 9 * * *",
				"2026-04-21T03:00:00.000Z",
				undefined,
				"Asia/Kathmandu",
			),
		).toBe("2026-04-21T03:15:00.000Z");
	});

	it.each([
		undefined,
		"Australia/Lord_Howe",
	])("finds the repeated half-hour in %s", (timezone) => {
		expect(
			getNextCronTimeWithHostTimezone(
				"45 1 * * *",
				"2026-04-04T14:45:00.000Z",
				timezone,
				"Australia/Lord_Howe",
			),
		).toBe("2026-04-04T15:15:00.000Z");
	});

	it("finds a sparse annual local schedule", () => {
		expect(
			getNextCronTimeWithHostTimezone(
				"0 0 1 1 *",
				"2026-01-01T05:00:00.000Z",
				undefined,
			),
		).toBe("2027-01-01T05:00:00.000Z");
	});

	it("rejects an impossible local calendar date", () => {
		expect(() =>
			getNextCronTime("0 0 31 2 *", Date.parse("2026-01-01T00:00:00.000Z")),
		).toThrow("No cron occurrence found within 4 years");
	});

	it("keeps the local four-year horizon across offset changes", () => {
		expect(
			getNextCronTimeWithHostTimezone(
				"0 0 29 2 *",
				"2012-02-28T20:00:00.000Z",
				undefined,
				"Europe/Moscow",
			),
		).toBe("2016-02-28T21:00:00.000Z");
	});

	it("keeps the host four-year horizon for an explicit timezone", () => {
		expect(
			getNextCronTimeWithHostTimezone(
				"0 0 29 2 *",
				"2012-02-28T20:00:00.000Z",
				"Europe/Moscow",
				"Europe/Moscow",
			),
		).toBe("2016-02-28T21:00:00.000Z");
	});

	it("checks a repeated calendar day before skipping to the next day", () => {
		expect(
			getNextCronTimeWithHostTimezone(
				"30 23 4 3 *",
				"2010-03-04T14:00:00.000Z",
				undefined,
				"Antarctica/Casey",
			),
		).toBe("2010-03-04T15:30:00.000Z");
	});

	it.each([
		undefined,
		"Africa/Monrovia",
	])("preserves host minute boundaries with a historical seconds offset in %s", (timezone) => {
		expect(
			getNextCronTimeWithHostTimezone(
				"0 0 1 1 *",
				"1970-01-01T00:44:00.000Z",
				timezone,
				"Africa/Monrovia",
			),
		).toBe("1970-01-01T00:44:30.000Z");
	});

	it("preserves historical host seconds when skipping days in an explicit timezone", () => {
		expect(
			getNextCronTimeWithHostTimezone(
				"0 0 2 1 *",
				"1969-12-25T00:00:00.000Z",
				"UTC",
				"Africa/Monrovia",
			),
		).toBe("1970-01-02T00:00:30.000Z");
	});

	it("checks local dates before the earliest representable UTC date", () => {
		expect(
			getNextCronTimeWithHostTimezone(
				"1 12 19 4 *",
				"-271821-04-20T00:00:00.000Z",
				"Etc/GMT+12",
				"UTC",
			),
		).toBe("-271821-04-20T00:01:00.000Z");
	});

	it("rejects an impossible calendar date in an explicit timezone", () => {
		expect(() =>
			getNextCronTime(
				"0 0 31 2 *",
				Date.parse("2026-01-01T00:00:00.000Z"),
				"UTC",
			),
		).toThrow("No cron occurrence found within 4 years");
	});
});
