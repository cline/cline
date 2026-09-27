interface ScheduleTiming {
	scheduleType: string;
	scheduleHour: string;
	scheduleMinute: string;
	scheduleDays: string[];
}

/** Unrelated edits must not reduce advanced cron expressions to daily/weekly. */
export function preserveRoutineCron(
	original: string,
	initial: ScheduleTiming,
	current: ScheduleTiming,
	replacement: string | undefined,
): string | undefined {
	const unchanged =
		initial.scheduleType === current.scheduleType &&
		initial.scheduleHour === current.scheduleHour &&
		initial.scheduleMinute === current.scheduleMinute &&
		(initial.scheduleType !== "weekly" ||
			[...initial.scheduleDays].sort().join(",") ===
				[...current.scheduleDays].sort().join(","));
	return unchanged ? original : replacement;
}
