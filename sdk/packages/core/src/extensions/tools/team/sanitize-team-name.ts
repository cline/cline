/**
 * Normalizes a team name into a safe storage key: lowercase, runs of
 * disallowed characters collapsed to `-`, leading/trailing `-` trimmed.
 */
export function sanitizeTeamName(name: string): string {
	const collapsed = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
	// Index-based trim: `/^-+|-+$/` backtracks quadratically on long `-` runs.
	let start = 0;
	let end = collapsed.length;
	while (start < end && collapsed[start] === "-") start++;
	while (end > start && collapsed[end - 1] === "-") end--;
	return collapsed.slice(start, end);
}
