export function normalizeCustomizationQuery(query: string) {
	return query.trim().toLowerCase();
}

/** Counts and readiness belong to the same query as their result model. */
export type CustomizeSearchState = {
	query: string;
	count: number;
	loading: boolean;
	error: boolean;
};
