import {
	CLINE_DEFAULT_MODEL_ID,
	ONE_TIME_SCHEDULE_CRON_PATTERN,
} from "@cline/shared/browser";
import { normalizeProviderId } from "@/lib/provider-id";
import { preserveRoutineCron } from "@/lib/routine-schedule-cron";
import { routineScheduleTimezone } from "@/lib/routine-schedule-timezone";
import { normalizeWorkspacePath } from "@/lib/workspace-paths";
import {
	asTrimmedFormString,
	buildCronPattern,
	buildRunAt,
	defaultScheduleDate,
	getScheduleDescription,
	getScheduleProviderModel,
	normalizeScheduleDays,
	parseCronPattern,
	parseScheduleTrigger,
	parseTags,
	WEEKDAY_OPTIONS,
	WORKWEEK_DAYS,
} from "../schedule-format";
import type { Schedule, ScheduleFormState } from "../schedule-types";

const DEFAULT_PROMPT = "Review PRs opened yesterday and summarize issues.";

/** A blank draft; callers override only what a template or a saved schedule supplies. */
export function createDefaultScheduleForm(
	overrides: Partial<ScheduleFormState> = {},
): ScheduleFormState {
	return {
		name: "",
		description: "",
		scheduleType: "once",
		scheduleDate: defaultScheduleDate(),
		scheduleHour: "9",
		scheduleMinute: "0",
		scheduleDays: [...WORKWEEK_DAYS],
		prompt: DEFAULT_PROMPT,
		provider: "cline",
		model: CLINE_DEFAULT_MODEL_ID,
		mode: "yolo",
		workspaceRoot: "",
		systemPrompt: "",
		timeoutSeconds: "",
		tags: "",
		enabled: true,
		...overrides,
	};
}

/** The draft that reproduces a saved schedule. */
export function formFromSchedule(schedule: Schedule): ScheduleFormState {
	return createDefaultScheduleForm({
		name: schedule.name,
		description: getScheduleDescription(schedule),
		...parseScheduleTrigger(schedule),
		prompt: schedule.prompt,
		...getScheduleProviderModel(schedule),
		mode: schedule.mode ?? "yolo",
		workspaceRoot: schedule.workspaceRoot ?? "",
		systemPrompt: schedule.systemPrompt ?? "",
		timeoutSeconds:
			typeof schedule.timeoutSeconds === "number"
				? String(schedule.timeoutSeconds)
				: "",
		tags: schedule.tags?.join(",") ?? "",
		enabled: schedule.enabled,
	});
}

export function isSameForm(left: ScheduleFormState, right: ScheduleFormState) {
	return JSON.stringify(left) === JSON.stringify(right);
}

const TIMING_KEYS = [
	"scheduleType",
	"scheduleDate",
	"scheduleHour",
	"scheduleMinute",
	"scheduleDays",
] as const satisfies readonly (keyof ScheduleFormState)[];

/** Whether two drafts would run at the same times. */
export function hasSameTiming(
	left: ScheduleFormState,
	right: ScheduleFormState,
) {
	return TIMING_KEYS.every(
		(key) => JSON.stringify(left[key]) === JSON.stringify(right[key]),
	);
}

/** The control a validation message belongs to, so focus can move there. */
export type ScheduleFormField =
	| "name"
	| "date"
	| "days"
	| "prompt"
	| "workspaceRoot"
	| "timeoutSeconds";

export type ScheduleFormIssue = {
	field: ScheduleFormField;
	message: string;
};

/** Draft values that decide whether each field's issue still applies. */
export const SCHEDULE_FIELD_FORM_KEYS: Readonly<
	Record<ScheduleFormField, readonly (keyof ScheduleFormState)[]>
> = {
	name: ["name"],
	date: ["scheduleType", "scheduleDate", "scheduleHour", "scheduleMinute"],
	days: ["scheduleType", "scheduleDays"],
	prompt: ["prompt"],
	workspaceRoot: ["workspaceRoot"],
	timeoutSeconds: ["timeoutSeconds"],
};

/** The first problem that prevents saving, in the order the fields appear. */
export function validateScheduleForm(
	form: ScheduleFormState,
	now = Date.now(),
): ScheduleFormIssue | null {
	if (!asTrimmedFormString(form.name)) {
		return { field: "name", message: "Schedule name is required." };
	}
	if (form.scheduleType === "once") {
		const runAt = buildRunAt(form);
		if (!runAt || runAt <= now) {
			return {
				field: "date",
				message: "Choose a one-time date and time in the future.",
			};
		}
	}
	if (
		form.scheduleType === "weekly" &&
		normalizeScheduleDays(form.scheduleDays).length === 0
	) {
		return { field: "days", message: "Select at least one weekday." };
	}
	if (!asTrimmedFormString(form.prompt)) {
		return { field: "prompt", message: "Add instructions for this schedule." };
	}
	if (!asTrimmedFormString(form.workspaceRoot)) {
		return { field: "workspaceRoot", message: "Choose a project folder." };
	}
	const timeout = asTrimmedFormString(form.timeoutSeconds);
	if (
		timeout &&
		(!/^\d+$/.test(timeout) ||
			!Number.isSafeInteger(Number(timeout)) ||
			Number(timeout) <= 0)
	) {
		return {
			field: "timeoutSeconds",
			message:
				"Enter the timeout as a whole number of seconds, or leave it blank.",
		};
	}
	return null;
}

function buildEditedCronPattern(form: ScheduleFormState): string | undefined {
	if (form.scheduleType === "once") return undefined;
	return buildCronPattern(
		form.scheduleType === "daily"
			? WEEKDAY_OPTIONS.map((option) => option.value)
			: form.scheduleDays,
		form.scheduleHour,
		form.scheduleMinute,
	);
}

/** The create/update request for a draft that has already passed validation. */
export function buildSchedulePayload(
	form: ScheduleFormState,
	editingSchedule: Schedule | null,
) {
	const editedCronPattern = buildEditedCronPattern(form);
	// Unrelated edits must not rewrite a custom cron expression.
	const cronPattern =
		editingSchedule &&
		editingSchedule.cronPattern !== ONE_TIME_SCHEDULE_CRON_PATTERN
			? preserveRoutineCron(
					editingSchedule.cronPattern,
					parseCronPattern(editingSchedule.cronPattern),
					form,
					editedCronPattern,
				)
			: editedCronPattern;
	const workspaceRoot = asTrimmedFormString(form.workspaceRoot);
	const systemPrompt = asTrimmedFormString(form.systemPrompt);
	const timeoutSeconds = form.timeoutSeconds.trim()
		? Number(form.timeoutSeconds)
		: undefined;
	// A folder change moves the run there; otherwise keep the saved subfolder.
	const keepsSavedFolder =
		editingSchedule !== null &&
		normalizeWorkspacePath(workspaceRoot) ===
			normalizeWorkspacePath(editingSchedule.workspaceRoot ?? "");
	return {
		...(editingSchedule
			? { schedule_id: editingSchedule.scheduleId }
			: undefined),
		name: asTrimmedFormString(form.name),
		description: asTrimmedFormString(form.description),
		schedule_type: form.scheduleType === "once" ? "once" : "recurring",
		run_at: form.scheduleType === "once" ? buildRunAt(form) : undefined,
		cron_pattern: cronPattern,
		timezone: routineScheduleTimezone(form.scheduleType, editingSchedule),
		prompt: asTrimmedFormString(form.prompt),
		provider:
			normalizeProviderId(asTrimmedFormString(form.provider)) || "cline",
		model: asTrimmedFormString(form.model) || CLINE_DEFAULT_MODEL_ID,
		mode: form.mode,
		workspace_root: workspaceRoot,
		cwd: keepsSavedFolder ? (editingSchedule?.cwd ?? null) : workspaceRoot,
		// Updates clear an emptied optional value; creates simply omit it.
		system_prompt: editingSchedule
			? systemPrompt || null
			: systemPrompt || undefined,
		timeout_seconds: editingSchedule
			? (timeoutSeconds ?? null)
			: timeoutSeconds,
		max_parallel: 1,
		enabled: form.enabled,
		tags: parseTags(form.tags) ?? [],
	};
}
