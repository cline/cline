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

/** Weekdays in the order the routine form lists them. */
const ROUTINE_WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** Cron day-of-week numbering, as the scheduler reads it: 0 is Sunday. */
const CRON_WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function parseCronWeekday(token: string): number | undefined {
	const named = CRON_WEEKDAYS.indexOf(token);
	if (named !== -1) return named;
	return /^[0-6]$/.test(token) ? Number(token) : undefined;
}

/**
 * Expand a cron day-of-week field into routine form weekdays. Reads the same
 * forms as the scheduler: numbers 0-6 (0 is Sunday) or names, in lists,
 * ranges, and steps. Parts the scheduler would reject are skipped.
 */
export function expandCronDays(dayExpression: string | undefined): string[] {
	const raw = dayExpression?.trim().toUpperCase();
	if (!raw || raw === "*") {
		return [...ROUTINE_WEEKDAYS];
	}
	const selected = new Set<string>();
	for (const part of raw.split(",")) {
		const [range = "", stepText, ...extraSteps] = part.trim().split("/");
		const step = stepText === undefined ? 1 : Number(stepText);
		if (extraSteps.length > 0 || !Number.isInteger(step) || step < 1) {
			continue;
		}
		const [fromText = "", toText, ...extraBounds] = range.split("-");
		if (extraBounds.length > 0) continue;
		// Like the scheduler, "*" spans the week and "N/step" runs to Saturday.
		const from = range === "*" ? 0 : parseCronWeekday(fromText);
		const to =
			range === "*" || (toText === undefined && stepText !== undefined)
				? 6
				: toText === undefined
					? from
					: parseCronWeekday(toText);
		if (from === undefined || to === undefined || from > to) continue;
		for (let day = from; day <= to; day += step) {
			selected.add(CRON_WEEKDAYS[day]);
		}
	}
	return ROUTINE_WEEKDAYS.filter((day) => selected.has(day));
}
