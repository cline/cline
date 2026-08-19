function parseCronField(
	token: string,
	min: number,
	max: number,
	names?: readonly string[],
): number[] {
	const results = new Set<number>();

	function resolveValue(raw: string): number {
		const lower = raw.toLowerCase();
		if (names) {
			const index = names.indexOf(lower);
			if (index !== -1) {
				return index + min;
			}
		}
		const value = Number(raw);
		if (!Number.isInteger(value) || value < min || value > max) {
			throw new Error(`Invalid cron value "${raw}" for range [${min}-${max}]`);
		}
		return value;
	}

	for (const part of token.split(",")) {
		if (part === "*") {
			for (let value = min; value <= max; value += 1) {
				results.add(value);
			}
			continue;
		}

		const stepSeparator = part.indexOf("/");
		if (stepSeparator !== -1) {
			const rangePart = part.slice(0, stepSeparator);
			const step = Number(part.slice(stepSeparator + 1));
			if (!Number.isInteger(step) || step < 1) {
				throw new Error(`Invalid step "${part.slice(stepSeparator + 1)}"`);
			}
			let from = min;
			let to = max;
			if (rangePart !== "*") {
				const dashIndex = rangePart.indexOf("-");
				if (dashIndex !== -1) {
					from = resolveValue(rangePart.slice(0, dashIndex));
					to = resolveValue(rangePart.slice(dashIndex + 1));
				} else {
					from = resolveValue(rangePart);
				}
			}
			if (from > to) {
				throw new Error(`Invalid cron range "${rangePart}"`);
			}
			for (let value = from; value <= to; value += step) {
				results.add(value);
			}
			continue;
		}

		const dashIndex = part.indexOf("-");
		if (dashIndex !== -1) {
			const from = resolveValue(part.slice(0, dashIndex));
			const to = resolveValue(part.slice(dashIndex + 1));
			if (from > to) {
				throw new Error(`Invalid cron range "${part}"`);
			}
			for (let value = from; value <= to; value += 1) {
				results.add(value);
			}
			continue;
		}

		results.add(resolveValue(part));
	}

	return [...results].sort((left, right) => left - right);
}

const MONTH_NAMES = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
] as const;

const DOW_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export interface ParsedCron {
	minutes: number[];
	hours: number[];
	daysOfMonth: number[];
	months: number[];
	daysOfWeek: number[];
}

interface CronDateParts {
	month: number;
	dayOfMonth: number;
	dayOfWeek: number;
	hour: number;
	minute: number;
}

function getRequiredField(
	fields: readonly string[],
	index: number,
	pattern: string,
): string {
	const value = fields[index];
	if (typeof value !== "string") {
		throw new Error(
			`Invalid cron pattern "${pattern}": missing field ${index + 1}`,
		);
	}
	return value;
}

function getFirstCronValue(values: readonly number[], label: string): number {
	const value = values[0];
	if (typeof value !== "number") {
		throw new Error(`Invalid cron pattern: no values parsed for ${label}`);
	}
	return value;
}

export function parseCron(pattern: string): ParsedCron {
	const fields = pattern.trim().split(/\s+/);
	if (fields.length !== 5) {
		throw new Error(
			`Invalid cron pattern "${pattern}": expected 5 fields, got ${fields.length}`,
		);
	}
	return {
		minutes: parseCronField(getRequiredField(fields, 0, pattern), 0, 59),
		hours: parseCronField(getRequiredField(fields, 1, pattern), 0, 23),
		daysOfMonth: parseCronField(getRequiredField(fields, 2, pattern), 1, 31),
		months: parseCronField(
			getRequiredField(fields, 3, pattern),
			1,
			12,
			MONTH_NAMES,
		),
		daysOfWeek: parseCronField(
			getRequiredField(fields, 4, pattern),
			0,
			6,
			DOW_NAMES,
		),
	};
}

export function validateCronPattern(pattern: string): void {
	parseCron(pattern);
}

export function validateCronSchedule(
	pattern: string,
	timezone?: string,
	after: number = Date.now(),
): void {
	getNextCronTime(pattern, after, timezone);
}

const TIMEZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const DOW_BY_SHORT_NAME = new Map(
	DOW_NAMES.map((name, index) => [name, index] as const),
);

function normalizeTimezone(timezone: string | undefined): string | undefined {
	const trimmed = timezone?.trim();
	return trimmed ? trimmed : undefined;
}

function getTimezoneFormatter(timezone: string): Intl.DateTimeFormat {
	const existing = TIMEZONE_FORMATTERS.get(timezone);
	if (existing) return existing;
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		calendar: "gregory",
		numberingSystem: "latn",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	TIMEZONE_FORMATTERS.set(timezone, formatter);
	return formatter;
}

export function validateTimezone(timezone: string | undefined): void {
	const normalized = normalizeTimezone(timezone);
	if (!normalized) return;
	getTimezoneFormatter(normalized).format(new Date());
}

function getZonedCronDateParts(
	timestampMs: number,
	timezone: string,
): CronDateParts {
	const parts = getTimezoneFormatter(timezone).formatToParts(
		new Date(timestampMs),
	);
	const byType = new Map(parts.map((part) => [part.type, part.value]));
	const weekdayRaw = byType.get("weekday")?.toLowerCase().slice(0, 3) ?? "";
	const dayOfWeek = DOW_BY_SHORT_NAME.get(
		weekdayRaw as (typeof DOW_NAMES)[number],
	);
	if (dayOfWeek === undefined) {
		throw new Error(`Unable to resolve weekday for timezone "${timezone}"`);
	}
	return {
		month: Number(byType.get("month")),
		dayOfMonth: Number(byType.get("day")),
		dayOfWeek,
		hour: Number(byType.get("hour")),
		minute: Number(byType.get("minute")),
	};
}

function getLocalCronDateParts(timestampMs: number): CronDateParts {
	const date = new Date(timestampMs);
	return {
		month: date.getMonth() + 1,
		dayOfMonth: date.getDate(),
		dayOfWeek: date.getDay(),
		hour: date.getHours(),
		minute: date.getMinutes(),
	};
}

function cronMatchesParts(cron: ParsedCron, parts: CronDateParts): boolean {
	return (
		cron.months.includes(parts.month) &&
		cron.daysOfMonth.includes(parts.dayOfMonth) &&
		cron.daysOfWeek.includes(parts.dayOfWeek) &&
		cron.hours.includes(parts.hour) &&
		cron.minutes.includes(parts.minute)
	);
}

function getNextCronTimeByMinuteScan(
	pattern: string,
	after: number,
	timezone: string,
): number {
	const cron = parseCron(pattern);
	const next = new Date(after);
	next.setSeconds(0, 0);
	let nextMs = next.getTime() + 60_000;

	const limit = new Date(after);
	limit.setFullYear(limit.getFullYear() + 4);
	const limitMs = limit.getTime();

	while (nextMs <= limitMs) {
		if (cronMatchesParts(cron, getZonedCronDateParts(nextMs, timezone))) {
			return nextMs;
		}
		nextMs += 60_000;
	}

	throw new Error(
		`No cron occurrence found within 4 years for pattern "${pattern}" in timezone "${timezone}"`,
	);
}

export function getNextCronTime(
	pattern: string,
	after: number,
	timezone?: string,
): number {
	const normalizedTimezone = normalizeTimezone(timezone);
	if (normalizedTimezone) {
		validateTimezone(normalizedTimezone);
		return getNextCronTimeByMinuteScan(pattern, after, normalizedTimezone);
	}

	const cron = parseCron(pattern);
	let next = new Date(after);
	next.setSeconds(0, 0);
	next = new Date(next.getTime() + 60_000);

	const limit = new Date(after);
	limit.setFullYear(limit.getFullYear() + 4);

	while (next <= limit) {
		const { month, dayOfMonth, dayOfWeek, hour, minute } =
			getLocalCronDateParts(next.getTime());

		if (!cron.months.includes(month)) {
			const targetMonth =
				cron.months.find((value) => value > month) ??
				getFirstCronValue(cron.months, "months");
			const yearDelta = targetMonth <= month ? 1 : 0;
			next = new Date(
				next.getFullYear() + yearDelta,
				targetMonth - 1,
				1,
				0,
				0,
				0,
				0,
			);
			continue;
		}

		if (
			!cron.daysOfMonth.includes(dayOfMonth) ||
			!cron.daysOfWeek.includes(dayOfWeek)
		) {
			next = new Date(
				next.getFullYear(),
				next.getMonth(),
				dayOfMonth + 1,
				0,
				0,
				0,
				0,
			);
			continue;
		}

		if (!cron.hours.includes(hour)) {
			const targetHour =
				cron.hours.find((value) => value > hour) ??
				getFirstCronValue(cron.hours, "hours");
			const dayDelta = targetHour <= hour ? 1 : 0;
			next = new Date(
				next.getFullYear(),
				next.getMonth(),
				next.getDate() + dayDelta,
				targetHour,
				0,
				0,
				0,
			);
			continue;
		}

		if (!cron.minutes.includes(minute)) {
			const targetMinute =
				cron.minutes.find((value) => value > minute) ??
				getFirstCronValue(cron.minutes, "minutes");
			const hourDelta = targetMinute <= minute ? 1 : 0;
			next = new Date(
				next.getFullYear(),
				next.getMonth(),
				next.getDate(),
				next.getHours() + hourDelta,
				targetMinute,
				0,
				0,
			);
			continue;
		}

		return next.getTime();
	}

	throw new Error(
		`No cron occurrence found within 4 years for pattern "${pattern}"`,
	);
}
