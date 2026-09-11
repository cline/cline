import { createHash } from "node:crypto";
import type {
	GitHubPrDashboardSnapshot,
	GitHubPullRequestRecord,
	GitHubPullRequestReviewRecord,
} from "./schema";

function timeMs(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = new Date(value).getTime();
	return Number.isFinite(parsed) ? parsed : undefined;
}

function hoursBetween(start: string, end: Date): number {
	const startMs = timeMs(start) ?? end.getTime();
	return Math.max(0, (end.getTime() - startMs) / 3_600_000);
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function dateKey(value: string): string {
	return value.slice(0, 10);
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
	map.set(key, (map.get(key) ?? 0) + amount);
}

function topCounts(
	map: Map<string, number>,
): Array<{ login: string; count: number }> {
	return [...map.entries()]
		.map(([login, count]) => ({ login, count }))
		.sort(
			(left, right) =>
				right.count - left.count || left.login.localeCompare(right.login),
		)
		.slice(0, 10);
}

function countByAuthor(
	pulls: Array<{ author: string; createdAt: string }>,
	sinceMs: number,
): Array<{ login: string; count: number }> {
	const counts = new Map<string, number>();
	for (const pull of pulls) {
		const createdMs = timeMs(pull.createdAt);
		if (createdMs !== undefined && createdMs >= sinceMs)
			increment(counts, pull.author);
	}
	return topCounts(counts);
}

function countByReviewer(
	reviews: GitHubPullRequestReviewRecord[],
	sinceMs: number,
): Array<{ login: string; count: number }> {
	const counts = new Map<string, number>();
	const unique = new Set<string>();
	for (const review of reviews) {
		const submittedMs = timeMs(review.submittedAt);
		if (submittedMs === undefined || submittedMs < sinceMs) continue;
		const key = `${review.repository}:${review.prNumber}:${review.reviewer}`;
		if (unique.has(key)) continue;
		unique.add(key);
		increment(counts, review.reviewer);
	}
	return topCounts(counts);
}

function emptyTrend(now: Date, trendDays: number) {
	return Array.from({ length: trendDays }, (_, index) => {
		const date = new Date(now);
		date.setUTCDate(date.getUTCDate() - (trendDays - index - 1));
		return {
			date: date.toISOString().slice(0, 10),
			opened: 0,
			closed: 0,
			merged: 0,
		};
	});
}

export function buildDashboardSnapshot(input: {
	generatedAt: Date;
	repositories: string[];
	pullsByRepo: Record<string, GitHubPullRequestRecord[]>;
	reviewsByRepo: Record<string, GitHubPullRequestReviewRecord[]>;
	newPrHours: number;
	recentlyClosedDays: number;
	trendDays: number;
}): GitHubPrDashboardSnapshot {
	const now = input.generatedAt;
	const newSinceMs = now.getTime() - input.newPrHours * 3_600_000;
	const closedSinceMs =
		now.getTime() - input.recentlyClosedDays * 24 * 3_600_000;
	const weekSinceMs = now.getTime() - 7 * 24 * 3_600_000;
	const monthSinceMs = now.getTime() - 30 * 24 * 3_600_000;
	const trendSinceMs = now.getTime() - input.trendDays * 24 * 3_600_000;

	const allPulls = input.repositories.flatMap((repository) =>
		(input.pullsByRepo[repository] ?? []).map((pull) => ({ repository, pull })),
	);
	const allReviews = input.repositories.flatMap(
		(repository) => input.reviewsByRepo[repository] ?? [],
	);
	const openPulls = allPulls.filter(({ pull }) => pull.state === "open");
	const newOpenPulls = openPulls.filter(
		({ pull }) => (timeMs(pull.createdAt) ?? 0) >= newSinceMs,
	);
	const recentlyClosedPulls = allPulls.filter(({ pull }) => {
		const closedMs = timeMs(pull.closedAt ?? pull.mergedAt);
		return closedMs !== undefined && closedMs >= closedSinceMs;
	});

	const waitingForReview = openPulls
		.filter(
			({ pull }) =>
				!pull.draft &&
				(pull.requestedReviewers.length > 0 || pull.requestedTeams.length > 0),
		)
		.map(({ repository, pull }) => ({
			repository,
			number: pull.number,
			title: pull.title,
			url: pull.url,
			author: pull.author,
			waitingHours: round1(hoursBetween(pull.createdAt, now)),
			requestedReviewers: pull.requestedReviewers,
			requestedTeams: pull.requestedTeams,
			updatedAt: pull.updatedAt,
		}))
		.sort((left, right) => right.waitingHours - left.waitingHours)
		.slice(0, 25);

	const trend = emptyTrend(now, input.trendDays);
	const trendByDate = new Map(trend.map((day) => [day.date, day]));
	for (const { pull } of allPulls) {
		const createdMs = timeMs(pull.createdAt);
		if (createdMs !== undefined && createdMs >= trendSinceMs) {
			const day = trendByDate.get(dateKey(pull.createdAt));
			if (day) day.opened += 1;
		}
		const closedAt = pull.closedAt ?? pull.mergedAt;
		const closedMs = timeMs(closedAt);
		if (closedAt && closedMs !== undefined && closedMs >= trendSinceMs) {
			const day = trendByDate.get(dateKey(closedAt));
			if (day) {
				day.closed += 1;
				if (pull.mergedAt) day.merged += 1;
			}
		}
	}

	const repositories = input.repositories.map((repository) => {
		const pulls = input.pullsByRepo[repository] ?? [];
		const repoOpen = pulls.filter((pull) => pull.state === "open");
		const repoWaiting = repoOpen.filter(
			(pull) =>
				!pull.draft &&
				(pull.requestedReviewers.length > 0 || pull.requestedTeams.length > 0),
		);
		return {
			repository,
			openCount: repoOpen.length,
			newOpenCount: repoOpen.filter(
				(pull) => (timeMs(pull.createdAt) ?? 0) >= newSinceMs,
			).length,
			recentlyClosedCount: pulls.filter((pull) => {
				const closedMs = timeMs(pull.closedAt ?? pull.mergedAt);
				return closedMs !== undefined && closedMs >= closedSinceMs;
			}).length,
			avgOpenAgeHours: average(
				repoOpen.map((pull) => hoursBetween(pull.createdAt, now)),
			),
			avgWaitingForReviewHours: average(
				repoWaiting.map((pull) => hoursBetween(pull.createdAt, now)),
			),
		};
	});

	return {
		generatedAt: now.toISOString(),
		repositories: input.repositories,
		window: {
			newPrHours: input.newPrHours,
			recentlyClosedDays: input.recentlyClosedDays,
			trendDays: input.trendDays,
		},
		summary: {
			openCount: openPulls.length,
			newOpenCount: newOpenPulls.length,
			recentlyClosedCount: recentlyClosedPulls.length,
			avgOpenAgeHours: average(
				openPulls.map(({ pull }) => hoursBetween(pull.createdAt, now)),
			),
			avgWaitingForReviewHours: average(
				waitingForReview.map((pull) => pull.waitingHours),
			),
		},
		waitingForReview,
		volumeTrend: trend,
		leadingAuthors: {
			week: countByAuthor(
				allPulls.map(({ pull }) => pull),
				weekSinceMs,
			),
			month: countByAuthor(
				allPulls.map(({ pull }) => pull),
				monthSinceMs,
			),
		},
		leadingReviewers: {
			week: countByReviewer(allReviews, weekSinceMs),
			month: countByReviewer(allReviews, monthSinceMs),
		},
		repositoryBreakdown: repositories,
	};
}

export function hashDashboardSnapshot(
	snapshot: GitHubPrDashboardSnapshot,
): string {
	const stableSnapshot = {
		...snapshot,
		generatedAt: undefined,
		summary: {
			...snapshot.summary,
			avgOpenAgeHours: 0,
			avgWaitingForReviewHours: 0,
		},
		waitingForReview: snapshot.waitingForReview.map((pull) => ({
			...pull,
			waitingHours: 0,
		})),
		repositoryBreakdown: snapshot.repositoryBreakdown.map((repository) => ({
			...repository,
			avgOpenAgeHours: 0,
			avgWaitingForReviewHours: 0,
		})),
	};
	return createHash("sha256")
		.update(JSON.stringify(stableSnapshot))
		.digest("hex");
}
