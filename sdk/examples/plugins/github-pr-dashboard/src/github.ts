import type {
	GitHubPullRequestRecord,
	GitHubPullRequestReviewRecord,
} from "./schema";

export interface GitHubPrDashboardConfig {
	repositories: string[];
	maxPullsPerRepo: number;
	maxOpenPages: number;
	maxClosedPages: number;
	newPrHours: number;
	recentlyClosedDays: number;
	trendDays: number;
	dashboardPath: string;
	token?: string;
}

export interface GitHubPrDashboardDataWarning {
	repository: string;
	type: "closed-pr-page-limit" | "open-pr-page-limit";
	message: string;
}

export interface GitHubPullApiRecord {
	number: number;
	title?: string;
	html_url?: string;
	state?: string;
	draft?: boolean;
	user?: { login?: string | null } | null;
	created_at?: string;
	updated_at?: string;
	closed_at?: string | null;
	merged_at?: string | null;
	requested_reviewers?: Array<{ login?: string | null }>;
	requested_teams?: Array<{ name?: string | null; slug?: string | null }>;
}

export interface GitHubReviewApiRecord {
	user?: { login?: string | null } | null;
	state?: string;
	submitted_at?: string | null;
}

export type FetchJson = (
	url: string,
	init: { headers: Record<string, string> },
) => Promise<unknown>;

type PullRequestStateFilter = "open" | "closed" | "all";

function splitCsv(value: string | undefined): string[] {
	return value
		? value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean)
		: [];
}

function positiveInt(
	value: string | undefined,
	fallback: number,
	max: number,
): number {
	const parsed = Number(value ?? fallback);
	return Number.isFinite(parsed) && parsed > 0
		? Math.min(Math.trunc(parsed), max)
		: fallback;
}

export function resolveGitHubPrDashboardConfig(
	env: NodeJS.ProcessEnv = process.env,
): GitHubPrDashboardConfig {
	const repositories = splitCsv(env.GITHUB_REPOSITORIES);
	if (repositories.length === 0) {
		throw new Error(
			"Set GITHUB_REPOSITORIES=owner/repo[,owner/repo] to use github-pr-dashboard",
		);
	}
	return {
		repositories,
		maxPullsPerRepo: positiveInt(env.GITHUB_PR_DASHBOARD_MAX_PRS, 25, 100),
		maxOpenPages: positiveInt(env.GITHUB_PR_DASHBOARD_MAX_OPEN_PAGES, 10, 50),
		maxClosedPages: positiveInt(
			env.GITHUB_PR_DASHBOARD_MAX_CLOSED_PAGES,
			10,
			50,
		),
		newPrHours: positiveInt(env.GITHUB_PR_DASHBOARD_NEW_HOURS, 24, 24 * 30),
		recentlyClosedDays: positiveInt(
			env.GITHUB_PR_DASHBOARD_RECENTLY_CLOSED_DAYS,
			7,
			365,
		),
		trendDays: positiveInt(env.GITHUB_PR_DASHBOARD_TREND_DAYS, 14, 365),
		dashboardPath:
			env.GITHUB_PR_DASHBOARD_PATH?.trim() || "github-pr-dashboard.md",
		token: env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim() || undefined,
	};
}

async function defaultFetchJson(
	url: string,
	init: { headers: Record<string, string> },
): Promise<unknown> {
	const response = await fetch(url, init);
	if (!response.ok) {
		throw new Error(
			`GitHub API request failed: ${response.status} ${response.statusText}`,
		);
	}
	return response.json();
}

function headersFor(config: GitHubPrDashboardConfig): Record<string, string> {
	const headers: Record<string, string> = {
		accept: "application/vnd.github+json",
		"user-agent": "cline-github-pr-dashboard-plugin",
		"x-github-api-version": "2022-11-28",
	};
	if (config.token) headers.authorization = `Bearer ${config.token}`;
	return headers;
}

function mergePullsByNumber(
	primary: GitHubPullRequestRecord[],
	secondary: GitHubPullRequestRecord[],
): GitHubPullRequestRecord[] {
	const merged = new Map<number, GitHubPullRequestRecord>();
	for (const pull of [...primary, ...secondary]) {
		merged.set(pull.number, pull);
	}
	return [...merged.values()].sort((left, right) => {
		const rightUpdated = new Date(right.updatedAt).getTime();
		const leftUpdated = new Date(left.updatedAt).getTime();
		return rightUpdated - leftUpdated || right.number - left.number;
	});
}

async function fetchPullsPage(options: {
	repository: string;
	state: PullRequestStateFilter;
	page: number;
	perPage: number;
	config: GitHubPrDashboardConfig;
	fetchJson: FetchJson;
}): Promise<GitHubPullRequestRecord[]> {
	const pullsParams = new URLSearchParams({
		state: options.state,
		sort: "updated",
		direction: "desc",
		per_page: String(options.perPage),
		page: String(options.page),
	});
	const pullsPayload = await options.fetchJson(
		`https://api.github.com/repos/${options.repository}/pulls?${pullsParams}`,
		{ headers: headersFor(options.config) },
	);
	if (!Array.isArray(pullsPayload)) {
		throw new Error(
			`GitHub API returned a non-array pulls payload for ${options.repository}`,
		);
	}
	return (pullsPayload as GitHubPullApiRecord[])
		.map((pull) => normalizePullRequest(options.repository, pull))
		.filter((pull): pull is GitHubPullRequestRecord => Boolean(pull));
}

async function fetchAllOpenPulls(options: {
	repository: string;
	config: GitHubPrDashboardConfig;
	fetchJson: FetchJson;
}): Promise<{
	pulls: GitHubPullRequestRecord[];
	warnings: GitHubPrDashboardDataWarning[];
}> {
	const perPage = 100;
	const pulls: GitHubPullRequestRecord[] = [];
	const warnings: GitHubPrDashboardDataWarning[] = [];
	for (let page = 1; page <= options.config.maxOpenPages; page += 1) {
		const pagePulls = await fetchPullsPage({
			...options,
			state: "open",
			page,
			perPage,
		});
		pulls.push(...pagePulls);
		if (pagePulls.length < perPage) break;
		if (page === options.config.maxOpenPages) {
			warnings.push({
				repository: options.repository,
				type: "open-pr-page-limit",
				message: `Open PR pagination reached ${options.config.maxOpenPages} pages for ${options.repository}; dashboard counts may be capped. Increase GITHUB_PR_DASHBOARD_MAX_OPEN_PAGES if needed.`,
			});
		}
	}
	return { pulls, warnings };
}

async function fetchRecentlyClosedPulls(options: {
	repository: string;
	config: GitHubPrDashboardConfig;
	fetchJson: FetchJson;
	now: Date;
}): Promise<{
	pulls: GitHubPullRequestRecord[];
	warnings: GitHubPrDashboardDataWarning[];
}> {
	const perPage = 100;
	const closedSinceMs =
		options.now.getTime() - options.config.recentlyClosedDays * 24 * 3_600_000;
	const pulls: GitHubPullRequestRecord[] = [];
	const warnings: GitHubPrDashboardDataWarning[] = [];
	for (let page = 1; page <= options.config.maxClosedPages; page += 1) {
		const pagePulls = await fetchPullsPage({
			...options,
			state: "closed",
			page,
			perPage,
		});
		if (pagePulls.length === 0) break;
		pulls.push(
			...pagePulls.filter((pull) => {
				const closedAt = pull.closedAt ?? pull.mergedAt;
				return closedAt ? new Date(closedAt).getTime() >= closedSinceMs : false;
			}),
		);

		const oldestUpdatedMs = Math.min(
			...pagePulls.map((pull) => new Date(pull.updatedAt).getTime()),
		);
		if (pagePulls.length < perPage || oldestUpdatedMs < closedSinceMs) break;
		if (page === options.config.maxClosedPages) {
			warnings.push({
				repository: options.repository,
				type: "closed-pr-page-limit",
				message: `Recently closed PR pagination reached ${options.config.maxClosedPages} pages for ${options.repository}; recently closed counts may be capped. Increase GITHUB_PR_DASHBOARD_MAX_CLOSED_PAGES if needed.`,
			});
		}
	}
	return { pulls, warnings };
}

async function fetchRecentActivityPulls(options: {
	repository: string;
	config: GitHubPrDashboardConfig;
	fetchJson: FetchJson;
}): Promise<GitHubPullRequestRecord[]> {
	return fetchPullsPage({
		...options,
		state: "all",
		page: 1,
		perPage: options.config.maxPullsPerRepo,
	});
}

export function normalizePullRequest(
	repository: string,
	pull: GitHubPullApiRecord,
): GitHubPullRequestRecord | undefined {
	if (!Number.isFinite(pull.number)) return undefined;
	if (!pull.created_at || !pull.updated_at) return undefined;
	return {
		number: pull.number,
		title: pull.title ?? `Pull request #${pull.number}`,
		url:
			pull.html_url ?? `https://github.com/${repository}/pull/${pull.number}`,
		state: pull.state ?? "open",
		draft: pull.draft === true,
		author: pull.user?.login ?? "unknown",
		createdAt: pull.created_at,
		updatedAt: pull.updated_at,
		...(pull.closed_at ? { closedAt: pull.closed_at } : {}),
		...(pull.merged_at ? { mergedAt: pull.merged_at } : {}),
		requestedReviewers: (pull.requested_reviewers ?? [])
			.map((reviewer) => reviewer.login)
			.filter((login): login is string => Boolean(login)),
		requestedTeams: (pull.requested_teams ?? [])
			.map((team) => team.slug ?? team.name)
			.filter((name): name is string => Boolean(name)),
	};
}

export function normalizeReview(
	repository: string,
	prNumber: number,
	review: GitHubReviewApiRecord,
): GitHubPullRequestReviewRecord | undefined {
	if (!review.submitted_at || !review.user?.login) return undefined;
	return {
		repository,
		prNumber,
		reviewer: review.user.login,
		state: review.state ?? "COMMENTED",
		submittedAt: review.submitted_at,
	};
}

export async function fetchGitHubPrDashboardData(options: {
	env?: NodeJS.ProcessEnv;
	fetchJson?: FetchJson;
	now?: Date;
}): Promise<{
	config: GitHubPrDashboardConfig;
	pullsByRepo: Record<string, GitHubPullRequestRecord[]>;
	reviewsByRepo: Record<string, GitHubPullRequestReviewRecord[]>;
	warnings: GitHubPrDashboardDataWarning[];
}> {
	const config = resolveGitHubPrDashboardConfig(options.env ?? process.env);
	const fetchJson = options.fetchJson ?? defaultFetchJson;
	const now = options.now ?? new Date();
	const pullsByRepo: Record<string, GitHubPullRequestRecord[]> = {};
	const reviewsByRepo: Record<string, GitHubPullRequestReviewRecord[]> = {};
	const warnings: GitHubPrDashboardDataWarning[] = [];

	for (const repository of config.repositories) {
		// Open PR count must be exact, so fetch and paginate open PRs separately.
		// Review calls remain bounded to the recent activity sample to avoid one
		// extra API request per open PR on large repositories.
		const [openPullsResult, recentlyClosedPullsResult, recentActivityPulls] =
			await Promise.all([
				fetchAllOpenPulls({ repository, config, fetchJson }),
				fetchRecentlyClosedPulls({ repository, config, fetchJson, now }),
				fetchRecentActivityPulls({ repository, config, fetchJson }),
			]);
		warnings.push(...openPullsResult.warnings);
		warnings.push(...recentlyClosedPullsResult.warnings);
		const pulls = mergePullsByNumber(
			mergePullsByNumber(
				openPullsResult.pulls,
				recentlyClosedPullsResult.pulls,
			),
			recentActivityPulls,
		);
		pullsByRepo[repository] = pulls;

		const reviews: GitHubPullRequestReviewRecord[] = [];
		for (const pull of recentActivityPulls) {
			const reviewsPayload = await fetchJson(
				`https://api.github.com/repos/${repository}/pulls/${pull.number}/reviews?per_page=100`,
				{ headers: headersFor(config) },
			);
			if (!Array.isArray(reviewsPayload)) continue;
			for (const review of reviewsPayload as GitHubReviewApiRecord[]) {
				const normalized = normalizeReview(repository, pull.number, review);
				if (normalized) reviews.push(normalized);
			}
		}
		reviewsByRepo[repository] = reviews;
	}

	return { config, pullsByRepo, reviewsByRepo, warnings };
}
