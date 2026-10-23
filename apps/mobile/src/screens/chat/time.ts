export function formatMessageRelativeTime(
	at: number,
	now = Date.now(),
): string {
	const delta = at - now;
	const absolute = Math.abs(delta);
	if (absolute < 60_000) return "just now";
	if (absolute < 60 * 60_000)
		return relativePhrase(Math.round(delta / 60_000), "minute");
	if (absolute < 24 * 60 * 60_000)
		return relativePhrase(Math.round(delta / (60 * 60_000)), "hour");
	return relativePhrase(Math.round(delta / (24 * 60 * 60_000)), "day");
}

/** Hermes in the current Expo runtime has DateTimeFormat but no RelativeTimeFormat. */
function relativePhrase(
	value: number,
	unit: "minute" | "hour" | "day",
): string {
	const amount = Math.abs(value);
	const label = `${unit}${amount === 1 ? "" : "s"}`;
	return value > 0 ? `in ${amount} ${label}` : `${amount} ${label} ago`;
}

export function formatMessageDay(at: number, now = Date.now()): string {
	const date = new Date(at);
	const today = new Date(now);
	if (sameDay(date, today)) return "Today";
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	if (sameDay(date, yesterday)) return "Yesterday";
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
	}).format(date);
}

export function startsNewMessageDay(at?: number, previousAt?: number): boolean {
	if (at === undefined || !Number.isFinite(at)) return false;
	if (previousAt === undefined || !Number.isFinite(previousAt)) return true;
	return !sameDay(new Date(at), new Date(previousAt));
}

function sameDay(left: Date, right: Date): boolean {
	return (
		left.getFullYear() === right.getFullYear() &&
		left.getMonth() === right.getMonth() &&
		left.getDate() === right.getDate()
	);
}
