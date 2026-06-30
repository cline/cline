import type { BasicLogger } from "@cline/core";
import { formatDashboardHandoff, summarizeDashboardChanges } from "./format";
import {
	type FetchJson,
	fetchGitHubPrDashboardData,
	type GitHubPrDashboardDataWarning,
} from "./github";
import { buildDashboardSnapshot, hashDashboardSnapshot } from "./metrics";
import type { GitHubPrDashboardRun, GitHubPrDashboardSnapshot } from "./schema";
import {
	type GitHubPrDashboardState,
	markSnapshotApplied,
	readState,
	resolveStatePath,
	writeState,
} from "./state";

export interface GitHubPrDashboardGateOptions {
	logger?: BasicLogger;
	env?: NodeJS.ProcessEnv;
	readState?: () => GitHubPrDashboardState;
	writeState?: (state: GitHubPrDashboardState) => void;
	fetchJson?: FetchJson;
	now?: () => Date;
}

export interface GitHubPrDashboardGateResult {
	stop?: boolean;
	reason: string;
	snapshot?: GitHubPrDashboardSnapshot;
	snapshotHash?: string;
	dashboardPath?: string;
	handoffText?: string;
	changeSummary?: string[];
	run?: GitHubPrDashboardRun;
	statePath?: string;
	warnings?: GitHubPrDashboardDataWarning[];
}

export interface ApplyGitHubPrDashboardSnapshotOptions {
	env?: NodeJS.ProcessEnv;
	statePath?: string;
	snapshotHash: string;
	readState?: () => GitHubPrDashboardState;
	writeState?: (state: GitHubPrDashboardState) => void;
}

function log(
	logger: BasicLogger | undefined,
	message: string,
	metadata?: Record<string, unknown>,
): void {
	logger?.log?.(message, metadata);
}

export async function runGitHubPrDashboardGate(
	options: GitHubPrDashboardGateOptions = {},
): Promise<GitHubPrDashboardGateResult> {
	const generatedAt = (options.now?.() ?? new Date()).toISOString();
	const statePath = resolveStatePath(options.env ?? process.env);
	const persistState =
		options.writeState ??
		((nextState: GitHubPrDashboardState) => writeState(nextState, statePath));
	const state = options.readState?.() ?? readState(statePath);
	const data = await fetchGitHubPrDashboardData({
		env: options.env,
		fetchJson: options.fetchJson,
		now: new Date(generatedAt),
	});
	const snapshot = buildDashboardSnapshot({
		generatedAt: new Date(generatedAt),
		repositories: data.config.repositories,
		pullsByRepo: data.pullsByRepo,
		reviewsByRepo: data.reviewsByRepo,
		newPrHours: data.config.newPrHours,
		recentlyClosedDays: data.config.recentlyClosedDays,
		trendDays: data.config.trendDays,
	});
	const snapshotHash = hashDashboardSnapshot(snapshot);
	const changeSummary = summarizeDashboardChanges(state.lastSnapshot, snapshot);

	if (state.lastSnapshotHash === snapshotHash) {
		persistState({
			version: 1,
			lastSnapshotHash: snapshotHash,
			lastGeneratedAt: generatedAt,
			lastSnapshot: snapshot,
		});
		log(options.logger, "github-pr-dashboard: no dashboard changes, exiting", {
			repositories: data.config.repositories,
			snapshotHash,
			warnings: data.warnings,
		});
		return {
			stop: true,
			reason: "no GitHub PR dashboard changes, exiting",
			snapshot,
			snapshotHash,
			dashboardPath: data.config.dashboardPath,
			changeSummary: [],
			statePath,
			warnings: data.warnings,
		};
	}

	persistState({
		version: 1,
		...(state.lastSnapshotHash
			? { lastSnapshotHash: state.lastSnapshotHash }
			: {}),
		...(state.lastGeneratedAt
			? { lastGeneratedAt: state.lastGeneratedAt }
			: {}),
		...(state.lastSnapshot ? { lastSnapshot: state.lastSnapshot } : {}),
		pendingSnapshotHash: snapshotHash,
		pendingGeneratedAt: generatedAt,
		pendingSnapshot: snapshot,
	});
	const run: GitHubPrDashboardRun = {
		runId: `github-pr-dashboard-${generatedAt}`,
		snapshotHash,
		dashboardPath: data.config.dashboardPath,
		snapshot,
		changeSummary,
	};
	const handoffText = formatDashboardHandoff(run);
	log(options.logger, "github-pr-dashboard: dashboard changes found", {
		repositories: data.config.repositories,
		snapshotHash,
		openCount: snapshot.summary.openCount,
		warnings: data.warnings,
	});
	return {
		reason: "GitHub PR dashboard data changed",
		snapshot,
		snapshotHash,
		dashboardPath: data.config.dashboardPath,
		changeSummary,
		handoffText,
		run,
		statePath,
		warnings: data.warnings,
	};
}

export function markGitHubPrDashboardSnapshotApplied(
	options: ApplyGitHubPrDashboardSnapshotOptions,
): boolean {
	const statePath =
		options.statePath ?? resolveStatePath(options.env ?? process.env);
	const currentState = options.readState?.() ?? readState(statePath);
	const nextState = markSnapshotApplied(currentState, options.snapshotHash);
	if (nextState === currentState) return false;
	(
		options.writeState ??
		((state: GitHubPrDashboardState) => writeState(state, statePath))
	)(nextState);
	return true;
}
