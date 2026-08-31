/** Lifecycle fields a background refresh may change on a history row. */
export interface HistoryStatusFields {
	sessionId: string;
	status?: string;
	endedAt?: string | null;
	exitCode?: number | null;
	updatedAt?: string;
}

/**
 * Overlays refreshed lifecycle fields onto already-hydrated rows: the
 * refreshed (unhydrated) list drives ordering and membership while hydrated
 * rows keep their titles/prompts/costs.
 */
export function mergeHistoryStatusRows<T extends HistoryStatusFields>(
	currentRows: T[],
	refreshedRows: T[],
): T[] {
	const currentById = new Map(
		currentRows.map((row) => [row.sessionId, row] as const),
	);

	return refreshedRows.map((row) => {
		const current = currentById.get(row.sessionId);
		if (!current) {
			return row;
		}
		return {
			...current,
			status: row.status,
			endedAt: row.endedAt,
			exitCode: row.exitCode,
			updatedAt: row.updatedAt,
		};
	});
}
