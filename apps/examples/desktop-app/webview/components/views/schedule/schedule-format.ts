import {
	CLINE_DEFAULT_MODEL_ID,
	ONE_TIME_SCHEDULE_CRON_PATTERN,
	ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY,
} from "@cline/shared/browser";
import type {
	DateTimeValue,
	Schedule,
	ScheduleFormState,
} from "./schedule-types";

export const WEEKDAY_OPTIONS = [
	{ label: "Monday", shortLabel: "Mon", value: "MON" },
	{ label: "Tuesday", shortLabel: "Tue", value: "TUE" },
	{ label: "Wednesday", shortLabel: "Wed", value: "WED" },
	{ label: "Thursday", shortLabel: "Thu", value: "THU" },
	{ label: "Friday", shortLabel: "Fri", value: "FRI" },
	{ label: "Saturday", shortLabel: "Sat", value: "SAT" },
	{ label: "Sunday", shortLabel: "Sun", value: "SUN" },
] as const;

/** The default selection for new weekly schedules. */
export const WORKWEEK_DAYS: readonly string[] = [
	"MON",
	"TUE",
	"WED",
	"THU",
	"FRI",
];

export function formatDateTime(value?: DateTimeValue | null): string {
	if (value === undefined || value === null) {
		return "-";
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			return "-";
		}
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return "-";
	}
	const parsed = new Date(trimmed);
	if (Number.isNaN(parsed.getTime())) {
		return trimmed;
	}
	return parsed.toLocaleString();
}

/** The optional summary a schedule was saved with; empty when it has none. */
export function getScheduleDescription(
	schedule: Pick<Schedule, "metadata">,
): string {
	const description = schedule.metadata?.description;
	return typeof description === "string" ? description : "";
}

export function getScheduleProviderModel(schedule: Schedule): {
	provider: string;
	model: string;
} {
	return {
		provider:
			schedule.modelSelection?.providerId?.trim() ||
			schedule.provider?.trim() ||
			"cline",
		model:
			schedule.modelSelection?.modelId?.trim() ||
			schedule.model?.trim() ||
			CLINE_DEFAULT_MODEL_ID,
	};
}

export function asTrimmedFormString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function parseTags(value: unknown): string[] | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const tags = value
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	return tags.length > 0 ? tags : undefined;
}

export function normalizeScheduleDays(days: string[]): string[] {
	const selected = new Set(days);
	return WEEKDAY_OPTIONS.map((option) => option.value).filter((value) =>
		selected.has(value),
	);
}

export function formatScheduleDays(days: string[]): string {
	const normalized = normalizeScheduleDays(days);
	if (normalized.length === WEEKDAY_OPTIONS.length) {
		return "Every day";
	}
	if (normalized.join(",") === WORKWEEK_DAYS.join(",")) {
		return "Weekdays";
	}
	return normalized
		.map(
			(value) =>
				WEEKDAY_OPTIONS.find((option) => option.value === value)?.shortLabel ??
				value,
		)
		.join(", ");
}

function formatLocalDateInput(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function formatLocalTimeInput(date: Date): string {
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	return `${hour}:${minute}`;
}

export function minimumOneTimeDateTime(now = new Date()): {
	date: string;
	time: string;
} {
	const minimum = new Date(now.getTime() + 60_000);
	minimum.setSeconds(0, 0);
	return {
		date: formatLocalDateInput(minimum),
		time: formatLocalTimeInput(minimum),
	};
}

export function defaultScheduleDate(): string {
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	return formatLocalDateInput(tomorrow);
}

export function buildRunAt(form: ScheduleFormState): number | undefined {
	if (!form.scheduleDate) {
		return undefined;
	}
	const runAt = new Date(
		`${form.scheduleDate}T${form.scheduleHour.padStart(2, "0")}:${form.scheduleMinute.padStart(2, "0")}:00`,
	).getTime();
	return Number.isFinite(runAt) ? runAt : undefined;
}

function getOneTimeScheduleRunAt(schedule: Schedule): number | undefined {
	const runAt = schedule.metadata?.[ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY];
	return typeof runAt === "number" && Number.isFinite(runAt)
		? runAt
		: undefined;
}

export function buildCronPattern(
	days: string[],
	hour: string,
	minute: string,
): string {
	const normalizedDays = normalizeScheduleDays(days);
	if (normalizedDays.length === 0) {
		return "";
	}
	const normalizedHour = Number.parseInt(hour, 10);
	const normalizedMinute = Number.parseInt(minute, 10);
	const cronHour = Number.isFinite(normalizedHour)
		? Math.min(Math.max(normalizedHour, 0), 23)
		: 9;
	const cronMinute = Number.isFinite(normalizedMinute)
		? Math.min(Math.max(normalizedMinute, 0), 59)
		: 0;
	if (normalizedDays.length === WEEKDAY_OPTIONS.length) {
		return `${cronMinute} ${cronHour} * * *`;
	}
	return `${cronMinute} ${cronHour} * * ${normalizedDays.join(",")}`;
}

const CRON_WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function cronDayIndex(value: string): number {
	if (/^\d+$/.test(value)) {
		const index = Number(value);
		return index <= 7 ? index : -1;
	}
	return CRON_WEEKDAYS.indexOf(value);
}

export function expandCronDays(dayExpression: string | undefined): string[] {
	const raw = dayExpression?.trim().toUpperCase();
	if (!raw || raw === "*") {
		return WEEKDAY_OPTIONS.map((option) => option.value);
	}
	const values = new Set<string>();
	for (const part of raw.split(",")) {
		const trimmed = part.trim();
		const rangeMatch = /^([A-Z]{3}|\d+)-([A-Z]{3}|\d+)$/.exec(trimmed);
		if (rangeMatch) {
			const start = cronDayIndex(rangeMatch[1]);
			const end = cronDayIndex(rangeMatch[2]);
			if (start < 0 || end < start) return [];
			for (let index = start; index <= end; index += 1) {
				values.add(CRON_WEEKDAYS[index % 7]);
			}
			continue;
		}
		const index = cronDayIndex(trimmed);
		if (index < 0) return [];
		values.add(CRON_WEEKDAYS[index % 7]);
	}
	return normalizeScheduleDays([...values]);
}

export type CronTiming =
	| { kind: "once" }
	| { kind: "daily" | "weekly"; hour: number; minute: number; days: string[] }
	| { kind: "custom" };

/**
 * The single place that decides whether a cron pattern is one the daily and
 * weekly controls can represent. Everything else is custom timing.
 */
export function classifyCronPattern(cronPattern: string): CronTiming {
	const trimmed = cronPattern.trim();
	if (trimmed === ONE_TIME_SCHEDULE_CRON_PATTERN) return { kind: "once" };
	const parts = trimmed.split(/\s+/);
	if (parts.length !== 5) return { kind: "custom" };
	const [minute, hour, dayOfMonth, month, weekday] = parts;
	if (
		!/^\d+$/.test(minute) ||
		Number(minute) > 59 ||
		!/^\d+$/.test(hour) ||
		Number(hour) > 23 ||
		dayOfMonth !== "*" ||
		month !== "*"
	) {
		return { kind: "custom" };
	}
	const days = expandCronDays(weekday);
	if (days.length === 0) return { kind: "custom" };
	return {
		kind: weekday === "*" ? "daily" : "weekly",
		hour: Number(hour),
		minute: Number(minute),
		days,
	};
}

/** Whether the saved timing cannot be fully represented by the daily/weekly controls. */
export function hasCustomScheduleTiming(cronPattern: string): boolean {
	return classifyCronPattern(cronPattern).kind === "custom";
}

export function parseCronPattern(
	cronPattern: string,
): Pick<
	ScheduleFormState,
	"scheduleType" | "scheduleHour" | "scheduleMinute" | "scheduleDays"
> {
	const parts = cronPattern.trim().split(/\s+/);
	const minute = Number.parseInt(parts[0] ?? "", 10);
	const hour = Number.parseInt(parts[1] ?? "", 10);
	const days = expandCronDays(parts[4]);
	return {
		scheduleType: parts[4] === "*" ? "daily" : "weekly",
		scheduleHour:
			Number.isInteger(hour) && hour >= 0 && hour <= 23 ? String(hour) : "9",
		scheduleMinute:
			Number.isInteger(minute) && minute >= 0 && minute <= 59
				? String(minute)
				: "0",
		scheduleDays: days.length > 0 ? days : [...WORKWEEK_DAYS],
	};
}

export function parseScheduleTrigger(
	schedule: Schedule,
): Pick<
	ScheduleFormState,
	| "scheduleType"
	| "scheduleDate"
	| "scheduleHour"
	| "scheduleMinute"
	| "scheduleDays"
> {
	if (schedule.cronPattern === ONE_TIME_SCHEDULE_CRON_PATTERN) {
		const date = new Date(
			getOneTimeScheduleRunAt(schedule) ?? schedule.nextRunAt ?? Date.now(),
		);
		return {
			scheduleType: "once",
			scheduleDate: formatLocalDateInput(date),
			scheduleHour: String(date.getHours()),
			scheduleMinute: String(date.getMinutes()),
			scheduleDays: [...WORKWEEK_DAYS],
		};
	}
	return {
		...parseCronPattern(schedule.cronPattern),
		scheduleDate: defaultScheduleDate(),
	};
}
