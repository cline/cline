/** Defaults apply only to new schedules; edits preserve timezone-less schedules. */
export function routineScheduleTimezone(
	scheduleType: "once" | "daily" | "weekly",
	existing?: { timezone?: string } | null,
): string | undefined {
	if (scheduleType === "once") return undefined;
	if (existing) return existing.timezone;
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Display the zone's abbreviation at the given time, including daylight saving. */
export function formatScheduleTimezone(
	timezone: string | undefined,
	at: Date | number = new Date(),
): string | undefined {
	if (!timezone) return undefined;
	try {
		return Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			timeZoneName: "short",
		})
			.formatToParts(at)
			.find((part) => part.type === "timeZoneName")?.value;
	} catch {
		return timezone.replaceAll("_", " ");
	}
}
