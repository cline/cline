export interface GitHubUserRef {
	login: string;
}

export interface GitHubPullRequestRecord {
	number: number;
	title: string;
	url: string;
	state: "open" | "closed" | string;
	draft: boolean;
	author: string;
	createdAt: string;
	updatedAt: string;
	closedAt?: string;
	mergedAt?: string;
	requestedReviewers: string[];
	requestedTeams: string[];
}

export interface GitHubPullRequestReviewRecord {
	prNumber: number;
	reviewer: string;
	state: string;
	submittedAt: string;
}

export interface GitHubPrDashboardSnapshot {
	generatedAt: string;
	repositories: string[];
	window: {
		newPrHours: number;
		recentlyClosedDays: number;
		trendDays: number;
	};
	summary: {
		openCount: number;
		newOpenCount: number;
		recentlyClosedCount: number;
		avgOpenAgeHours: number;
		avgWaitingForReviewHours: number;
	};
	waitingForReview: Array<{
		repository: string;
		number: number;
		title: string;
		url: string;
		author: string;
		waitingHours: number;
		requestedReviewers: string[];
		requestedTeams: string[];
		updatedAt: string;
	}>;
	volumeTrend: Array<{
		date: string;
		opened: number;
		closed: number;
		merged: number;
	}>;
	leadingAuthors: {
		week: Array<{ login: string; count: number }>;
		month: Array<{ login: string; count: number }>;
	};
	leadingReviewers: {
		week: Array<{ login: string; count: number }>;
		month: Array<{ login: string; count: number }>;
	};
	repositoryBreakdown: Array<{
		repository: string;
		openCount: number;
		newOpenCount: number;
		recentlyClosedCount: number;
		avgOpenAgeHours: number;
		avgWaitingForReviewHours: number;
	}>;
}

export interface GitHubPrDashboardRun {
	runId: string;
	snapshotHash: string;
	dashboardPath: string;
	snapshot: GitHubPrDashboardSnapshot;
	changeSummary: string[];
}
