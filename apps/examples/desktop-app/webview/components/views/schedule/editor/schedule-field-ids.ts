import type { ScheduleFormField } from "./schedule-form-model";

/** Element ids shared by the labels, the fields, and validation focus. */
export const SCHEDULE_FIELD_IDS = {
	name: "schedule-name",
	description: "schedule-description",
	type: "schedule-frequency",
	date: "schedule-date",
	days: "schedule-days",
	time: "schedule-time",
	workspace: "schedule-workspace",
	prompt: "schedule-prompt",
	mode: "schedule-mode",
	timeout: "schedule-timeout",
	tags: "schedule-tags",
	systemPrompt: "schedule-system-prompt",
} as const;

/** Where focus goes when a validation message names a field. */
export const SCHEDULE_ISSUE_FIELD_IDS: Readonly<
	Record<ScheduleFormField, string>
> = {
	name: SCHEDULE_FIELD_IDS.name,
	date: SCHEDULE_FIELD_IDS.date,
	days: SCHEDULE_FIELD_IDS.days,
	prompt: SCHEDULE_FIELD_IDS.prompt,
	workspaceRoot: SCHEDULE_FIELD_IDS.workspace,
	timeoutSeconds: SCHEDULE_FIELD_IDS.timeout,
};
