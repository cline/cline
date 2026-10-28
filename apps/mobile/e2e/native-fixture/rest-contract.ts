/** REST response construction shared by fixture routes and shipping-Gateway contract tests. */
export function scopedFixtureRows<T extends { organizationId?: unknown }>(
	rows: T[],
	organizationId?: string,
): T[] {
	return rows.filter(
		(row) =>
			(row.organizationId || undefined) === (organizationId || undefined),
	);
}
export function fixtureLifecycleDto<T extends { id: unknown; status: unknown }>(
	row: T,
	action: "resume" | "suspend",
): T {
	row.status = action === "suspend" ? "suspended" : "running";
	return { ...row };
}
