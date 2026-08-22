/**
 * Small, deterministic cron surface for Gateway routines.
 *
 * The desktop routine editor emits fixed minute/hour five-field patterns
 * with either every day or a weekday list/range. Supporting that grammar
 * directly keeps scheduling Gateway-owned without importing the legacy Core
 * cron runtime.
 */

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

interface ParsedCronPattern {
	readonly minute: number;
	readonly hour: number;
	readonly days: ReadonlySet<number>;
}

function parseInteger(value: string, label: string, max: number): number {
	if (!/^\d+$/.test(value)) {
		throw new Error(`${label} must be an integer`);
	}
	const parsed = Number(value);
	if (parsed < 0 || parsed > max) {
		throw new Error(`${label} must be between 0 and ${max}`);
	}
	return parsed;
}

function dayIndex(value: string): number {
	const index = DAY_NAMES.indexOf(value as (typeof DAY_NAMES)[number]);
	if (index < 0) {
		throw new Error(`Unknown cron weekday: ${value}`);
	}
	return index;
}

function parseDays(expression: string): ReadonlySet<number> {
	if (expression === "*") {
		return new Set(DAY_NAMES.map((_, index) => index));
	}
	const days = new Set<number>();
	for (const rawPart of expression.toUpperCase().split(",")) {
		const part = rawPart.trim();
		if (!part) throw new Error("Cron weekday entries must not be empty");
		const range = /^([A-Z]{3})-([A-Z]{3})$/.exec(part);
		if (range) {
			const start = dayIndex(range[1]);
			const end = dayIndex(range[2]);
			if (end < start) {
				throw new Error(`Cron weekday range must be ascending: ${part}`);
			}
			for (let day = start; day <= end; day += 1) days.add(day);
			continue;
		}
		days.add(dayIndex(part));
	}
	if (days.size === 0) throw new Error("Cron pattern requires a weekday");
	return days;
}

export function parseCronPattern(pattern: string): ParsedCronPattern {
	const fields = pattern.trim().split(/\s+/);
	if (fields.length !== 5 || fields[2] !== "*" || fields[3] !== "*") {
		throw new Error("Cron pattern must use 'minute hour * * weekdays' format");
	}
	return {
		minute: parseInteger(fields[0], "Cron minute", 59),
		hour: parseInteger(fields[1], "Cron hour", 23),
		days: parseDays(fields[4]),
	};
}

/** Return the first local-time firing strictly after `after`. */
export function nextCronDueAt(pattern: string, after: number): number {
	const parsed = parseCronPattern(pattern);
	const candidate = new Date(after);
	candidate.setSeconds(0, 0);
	candidate.setMinutes(candidate.getMinutes() + 1);
	// The supported grammar always has at least one firing within seven days.
	for (let minute = 0; minute <= 8 * 24 * 60; minute += 1) {
		if (
			candidate.getMinutes() === parsed.minute &&
			candidate.getHours() === parsed.hour &&
			parsed.days.has(candidate.getDay())
		) {
			return candidate.getTime();
		}
		candidate.setMinutes(candidate.getMinutes() + 1);
	}
	throw new Error(`Cron pattern has no upcoming firing: ${pattern}`);
}
