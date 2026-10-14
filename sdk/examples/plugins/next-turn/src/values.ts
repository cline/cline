export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function isoMillis(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** The records in the array under `key`; anything else reads as none. */
export function listOf(
	payload: unknown,
	key: string,
): Record<string, unknown>[] {
	const list = isRecord(payload) ? payload[key] : undefined;
	return Array.isArray(list) ? list.filter(isRecord) : [];
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
