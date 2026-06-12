/**
 * Normalize a GeoJSON feature's `photos` property into a list of file paths.
 * The property may arrive as a real array, a JSON-encoded string (CSV import
 * flattens arrays to text), or a comma-separated string.
 */
export function extractPhotoPaths(value: unknown): string[] {
	if (!value) {
		return []
	}
	if (Array.isArray(value)) {
		return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
	}
	if (typeof value === "string") {
		const trimmed = value.trim()
		if (!trimmed) {
			return []
		}
		if (trimmed.startsWith("[")) {
			try {
				const parsed = JSON.parse(trimmed)
				if (Array.isArray(parsed)) {
					return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
				}
			} catch {
				/* fall through to comma split */
			}
		}
		return trimmed
			.split(/[,;]/)
			.map((s) => s.trim())
			.filter(Boolean)
	}
	return []
}
