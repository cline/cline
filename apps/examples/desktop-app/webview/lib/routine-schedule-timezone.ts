/** Defaults apply only to new schedules; edits preserve timezone-less schedules. */
export function routineScheduleTimezone(
	scheduleType: "once" | "daily" | "weekly",
	existing?: { timezone?: string } | null,
): string | undefined {
	if (scheduleType === "once") return undefined;
	if (existing) return existing.timezone;
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
