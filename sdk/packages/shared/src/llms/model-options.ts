function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeModelOptions(
	base: Record<string, unknown> | undefined,
	next: Record<string, unknown>,
): Record<string, unknown>;
export function mergeModelOptions(
	base: Record<string, unknown> | undefined,
	next: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined;
export function mergeModelOptions(
	base: Record<string, unknown> | undefined,
	next: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!base && !next) return undefined;
	const baseMetadata = base?.metadata;
	const nextMetadata = next?.metadata;
	const merged = { ...(base ?? {}), ...(next ?? {}) };
	if (isRecord(baseMetadata) && isRecord(nextMetadata)) {
		merged.metadata = { ...baseMetadata, ...nextMetadata };
	}
	return merged;
}
