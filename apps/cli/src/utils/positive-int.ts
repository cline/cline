/**
 * Parses a whole number of at least 1. Unlike `Number.parseInt`, a value with
 * trailing characters ("10m", "1.5", "1e3") is rejected instead of being
 * read as its leading digits.
 */
export function parsePositiveInt(raw: string): number | undefined {
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) {
		return undefined;
	}
	const parsed = Number(trimmed);
	return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
}
