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
		"node",
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
			"the second occurrence in an explicit timezone",
			"30 1 * * *",
			"2026-11-01T06:00:00.000Z",
			"America/New_York",
			"2026-11-01T06:30:00.000Z",
		],
		[
			"the second occurrence in the local timezone",
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
});
