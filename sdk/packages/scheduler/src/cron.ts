const MONTH_NAMES: Record<string, number> = {
	JAN: 1,
	FEB: 2,
	MAR: 3,
	APR: 4,
	MAY: 5,
	JUN: 6,
	JUL: 7,
	AUG: 8,
	SEP: 9,
	OCT: 10,
	NOV: 11,
	DEC: 12,
};

const WEEKDAY_NAMES: Record<string, number> = {
	SUN: 0,
	MON: 1,
	TUE: 2,
	WED: 3,
	THU: 4,
	FRI: 5,
	SAT: 6,
};

interface CronField {
	kind: "any" | "list";
	values?: Set<number>;
}

interface ParsedCron {
	minute: CronField;
	hour: CronField;
	dayOfMonth: CronField;
	month: CronField;
	dayOfWeek: CronField;
}

function normalizeToken(
	raw: string,
	nameMap: Record<string, number> | undefined,
): string {
	let token = raw.trim().toUpperCase();
	if (!nameMap) {
		return token;
	}
	for (const [name, value] of Object.entries(nameMap)) {
		token = token.replaceAll(name, String(value));
	}
	return token;
}

function parseValue(value: string, min: number, max: number): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed)) {
		throw new Error(`invalid cron value "${value}"`);
	}
	if (parsed < min || parsed > max) {
		throw new Error(`cron value out of range: ${value}`);
	}
	return parsed;
}

function pushRange(
	values: Set<number>,
	start: number,
	end: number,
	step: number,
	min: number,
	max: number,
	isDayOfWeek = false,
): void {
	if (step <= 0) {
		throw new Error("cron step must be positive");
	}
	if (start > end) {
		throw new Error("cron range start must be <= end");
	}
	if (start < min || end > max) {
		throw new Error(`cron range ${start}-${end} out of bounds`);
	}
	for (let current = start; current <= end; current += step) {
		if (isDayOfWeek && current === 7) {
			values.add(0);
			continue;
		}
		values.add(current);
	}
}

function parsePart(
	part: string,
	min: number,
	max: number,
	nameMap?: Record<string, number>,
	isDayOfWeek = false,
): CronField {
	const normalized = normalizeToken(part, nameMap);
	if (normalized === "*") {
		return { kind: "any" };
	}
	const values = new Set<number>();
	const segments = normalized.split(",").map((segment) => segment.trim());
	for (const segment of segments) {
		if (!segment) {
			continue;
		}
		const [rangeExpression, stepExpression] = segment.split("/");
		const step =
			stepExpression !== undefined
				? parseValue(stepExpression, 1, Number.MAX_SAFE_INTEGER)
				: 1;
		if (rangeExpression === "*") {
			pushRange(values, min, max, step, min, max, isDayOfWeek);
			continue;
		}
		if (rangeExpression.includes("-")) {
			const [rawStart, rawEnd] = rangeExpression
				.split("-")
				.map((item) => item.trim());
			const start = parseValue(rawStart, min, max);
			const end = parseValue(rawEnd, min, max);
			pushRange(values, start, end, step, min, max, isDayOfWeek);
			continue;
		}
		const value = parseValue(rangeExpression, min, max);
		if (isDayOfWeek && value === 7) {
			values.add(0);
		} else {
			values.add(value);
		}
	}
	if (values.size === 0) {
		throw new Error(`invalid cron part "${part}"`);
	}
	return { kind: "list", values };
}

function parseCronExpression(pattern: string): ParsedCron {
	const parts = pattern
		.trim()
		.split(/\s+/)
		.map((part) => part.trim());
	if (parts.length !== 5) {
		throw new Error("cron pattern must contain exactly 5 fields");
	}
	return {
		minute: parsePart(parts[0], 0, 59),
		hour: parsePart(parts[1], 0, 23),
		dayOfMonth: parsePart(parts[2], 1, 31),
		month: parsePart(parts[3], 1, 12, MONTH_NAMES),
		dayOfWeek: parsePart(parts[4], 0, 7, WEEKDAY_NAMES, true),
	};
}

function matches(field: CronField, value: number): boolean {
	if (field.kind === "any") {
		return true;
	}
	return field.values?.has(value) === true;
}

function floorToMinute(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		date.getHours(),
		date.getMinutes(),
		0,
		0,
	);
}

function matchesDate(cron: ParsedCron, date: Date): boolean {
	const month = date.getMonth() + 1;
	const dayOfMonth = date.getDate();
	const dayOfWeek = date.getDay();
	return (
		matches(cron.minute, date.getMinutes()) &&
		matches(cron.hour, date.getHours()) &&
		matches(cron.month, month) &&
		matches(cron.dayOfMonth, dayOfMonth) &&
		matches(cron.dayOfWeek, dayOfWeek)
	);
}

export function assertValidCronPattern(pattern: string): void {
	void parseCronExpression(pattern);
}

export function getNextCronRun(pattern: string, from: Date): string {
	const cron = parseCronExpression(pattern);
	const cursor = floorToMinute(from);
	cursor.setMinutes(cursor.getMinutes() + 1);

	const maxIterations = 366 * 24 * 60;
	for (let i = 0; i < maxIterations; i += 1) {
		if (matchesDate(cron, cursor)) {
			return cursor.toISOString();
		}
		cursor.setMinutes(cursor.getMinutes() + 1);
	}
	throw new Error("unable to resolve next run for cron pattern within 1 year");
}
