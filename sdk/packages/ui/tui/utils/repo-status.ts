import type { RepoStatus } from "../types";

export function isSameRepoStatus(a: RepoStatus, b: RepoStatus): boolean {
	if (a.branch !== b.branch) return false;
	if (a.diffStats === null || b.diffStats === null) {
		return a.diffStats === b.diffStats;
	}
	return (
		a.diffStats.files === b.diffStats.files &&
		a.diffStats.additions === b.diffStats.additions &&
		a.diffStats.deletions === b.diffStats.deletions
	);
}
