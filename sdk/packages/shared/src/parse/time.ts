/**
 * Parses a date string and returns a human-readable format.
 * If the input is invalid, it returns the original string or a placeholder.
 *
 * @param dateStr - The date string to parse.
 * @returns A human-readable date string or the original input if invalid.
 */
export function formatHumanReadableDate(dateStr?: string): string {
	if (!dateStr) return "(unknown-date)";
	const date = new Date(dateStr);
	if (Number.isNaN(date.getTime())) return dateStr;
	return date.toLocaleString("en-US", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		hour12: true,
	});
}

export function formatUptime(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}
