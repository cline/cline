"use client";

import {
	ChevronDown,
	ExternalLink,
	GitBranch,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	RefreshCw,
	X,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";

export type AgentPullRequestCheck = {
	name: string;
	state: "pending" | "success" | "failure" | "skipped";
	url?: string;
};
export type AgentPullRequestData = {
	repository: string;
	branch: string;
	branchUrl?: string;
	createUrl?: string | null;
	published?: boolean;
	pullRequest?: {
		number: number;
		title: string;
		url: string;
		state: "OPEN" | "CLOSED" | "MERGED";
		isDraft: boolean;
		mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
		mergeStateStatus: string;
		additions?: number;
		deletions?: number;
		checks?: AgentPullRequestCheck[];
		checksUnavailable?: boolean;
	} | null;
};
export type AgentPullRequestNavigation = "open" | "create" | "check" | "branch";
export type AgentPullRequestBarProps = {
	data?: AgentPullRequestData | null;
	error?: string | null;
	loading?: boolean;
	onRefresh: () => void;
	onDismissError?: () => void;
	/** Native hosts intercept navigation; web hosts use ordinary external links. */
	onNavigate?: (url: string, action: AgentPullRequestNavigation) => void;
	/** Hosts supply their established accessible popover, including its portal. */
	renderChecks: (trigger: ReactElement, content: ReactElement) => ReactNode;
};
export function getAgentPullRequestMergeStatus(
	pr: NonNullable<AgentPullRequestData["pullRequest"]>,
) {
	if (pr.state === "MERGED")
		return { label: "Merged", tone: "merged" } as const;
	if (pr.state === "CLOSED")
		return { label: "Closed", tone: "failure" } as const;
	if (pr.isDraft) return { label: "Draft", tone: "neutral" } as const;
	if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY")
		return { label: "Conflicts", tone: "failure" } as const;
	if (pr.mergeStateStatus === "BLOCKED")
		return { label: "Blocked", tone: "warning" } as const;
	if (pr.mergeStateStatus === "BEHIND")
		return { label: "Behind base", tone: "warning" } as const;
	if (pr.mergeStateStatus === "UNSTABLE")
		return { label: "Checks failing", tone: "failure" } as const;
	if (pr.mergeable === "UNKNOWN")
		return { label: "Merge status pending", tone: "neutral" } as const;
	if (pr.mergeStateStatus === "CLEAN")
		return { label: "Ready to merge", tone: "success" } as const;
	if (pr.mergeable === "MERGEABLE")
		return { label: "No conflicts", tone: "neutral" } as const;
	return { label: "Merge status pending", tone: "neutral" } as const;
}
export function summarizeAgentPullRequestChecks(
	checks: AgentPullRequestCheck[],
) {
	if (!checks.length) return "none";
	if (checks.some((c) => c.state === "failure")) return "failure";
	if (checks.some((c) => c.state === "pending")) return "pending";
	if (checks.every((c) => c.state === "skipped")) return "skipped";
	return "success";
}
const checkLabels = {
	unavailable: "CI unavailable",
	none: "No checks",
	pending: "CI pending",
	success: "CI passed",
	failure: "CI failed",
	skipped: "CI skipped",
};
const statusColors = {
	merged: "text-purple-400",
	failure: "text-red-400",
	warning: "text-yellow-500",
	neutral: "text-cline-ui-muted-foreground",
	success: "text-green-500",
};
const checkColors = {
	unavailable: "bg-cline-ui-muted-foreground",
	none: "bg-cline-ui-muted-foreground",
	pending: "bg-yellow-500",
	success: "bg-green-500",
	failure: "bg-red-500",
	skipped: "bg-cline-ui-muted-foreground",
};
export function AgentPullRequestBar({
	data,
	error,
	loading = false,
	onRefresh,
	onDismissError,
	onNavigate,
	renderChecks,
}: AgentPullRequestBarProps) {
	const pr = data?.pullRequest;
	const PullRequestIcon =
		pr?.state === "MERGED"
			? GitMerge
			: pr?.state === "CLOSED"
				? GitPullRequestClosed
				: pr?.isDraft
					? GitPullRequestDraft
					: pr || data?.createUrl
						? GitPullRequest
						: GitBranch;
	if (!error && !data?.branch && !pr) return null;
	const status = pr ? getAgentPullRequestMergeStatus(pr) : null;
	const ci =
		!pr?.checks || pr.checksUnavailable
			? "unavailable"
			: summarizeAgentPullRequestChecks(pr.checks);
	const link = (
		url: string,
		action: AgentPullRequestNavigation,
		children: ReactNode,
		title?: string,
		label?: string,
	) =>
		onNavigate ? (
			<button
				type="button"
				className={`cline-ui-pr-bar__link hover:underline ${action === "open" || action === "create" ? "shrink-0 font-medium" : "text-left"}`}
				title={title}
				aria-label={label}
				onClick={() => onNavigate(url, action)}
			>
				{children}
				{(action === "create" || action === "check") && (
					<>
						{" "}
						<ExternalLink className="inline size-3" />
					</>
				)}
			</button>
		) : (
			<a
				className={`cline-ui-pr-bar__link hover:underline ${action === "open" || action === "create" ? "shrink-0 font-medium" : "text-left"}`}
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				title={title}
				aria-label={label}
			>
				{children}
				{(action === "create" || action === "check") && (
					<>
						{" "}
						<ExternalLink className="inline size-3" />
					</>
				)}
			</a>
		);
	const checksContent = (
		<div
			className="cline-ui-pr-bar__checks p-3"
			data-native-navigation={onNavigate ? true : undefined}
		>
			<p className="cline-ui-pr-bar__checks-title mb-2 text-cline-ui-sm font-medium">
				Checks for #{pr?.number}
			</p>
			{ci === "unavailable" ? (
				<p className="text-cline-ui-xs text-cline-ui-muted-foreground">
					Checks could not be loaded. Refresh to try again.
				</p>
			) : ci === "none" ? (
				<p className="text-cline-ui-xs text-cline-ui-muted-foreground">
					No checks reported for this pull request.
				</p>
			) : null}
			<ul className="max-h-64 space-y-2 overflow-y-auto">
				{pr?.checks?.map((check, index) => (
					<li
						className="flex items-center gap-2 text-cline-ui-xs"
						key={`${check.name}:${index}`}
					>
						<span
							aria-hidden="true"
							className={`cline-ui-pr-bar__dot size-2 shrink-0 rounded-full ${checkColors[check.state]}`}
							data-state={check.state}
						/>
						<span className="cline-ui-pr-bar__check-name min-w-0 flex-1 break-words">
							{check.url ? link(check.url, "check", check.name) : check.name}
						</span>
						<span
							className={`cline-ui-pr-bar__muted text-cline-ui-muted-foreground ${onNavigate ? "" : "shrink-0"}`}
						>
							{check.state}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
	return (
		<section
			className="cline-ui-pr-bar border-b border-cline-ui-border px-4 py-2 text-cline-ui-xs"
			aria-label="Pull request status"
			data-native-navigation={onNavigate ? true : undefined}
		>
			{error && (
				<div className="cline-ui-pr-bar__error mb-1 flex items-start gap-2 text-cline-ui-muted-foreground">
					<output className="min-w-0 flex-1">{error}</output>
					{onDismissError && (
						<button
							type="button"
							aria-label="Dismiss pull request error"
							className="shrink-0 rounded p-1 hover:bg-cline-ui-muted"
							onClick={onDismissError}
						>
							<X className="size-3" />
						</button>
					)}
				</div>
			)}
			<div className="cline-ui-pr-bar__row flex min-w-0 flex-wrap items-center gap-2">
				{data &&
					(data.branch ? (
						<>
							<PullRequestIcon
								className={`cline-ui-pr-bar__icon size-4 shrink-0 cline-ui-pr-bar__tone--${status?.tone ?? "neutral"} ${statusColors[status?.tone ?? "neutral"]}`}
							/>
							{pr ? (
								<>
									{link(
										pr.url,
										"open",
										<>#{pr.number}</>,
										pr.title,
										`Open pull request #${pr.number}: ${pr.title}`,
									)}
									<span
										className={`shrink-0 cline-ui-pr-bar__tone--${status?.tone} ${statusColors[status?.tone ?? "neutral"]}`}
									>
										{status?.label}
									</span>
								</>
							) : data.createUrl ? (
								link(
									data.createUrl,
									"create",
									"Create PR",
									"Open GitHub’s comparison form for this branch. Push your commits before submitting.",
								)
							) : null}
							<span
								className="cline-ui-pr-bar__branch min-w-0 flex-1 truncate text-cline-ui-muted-foreground"
								title={`${data.repository} · ${data.branch}`}
							>
								{data.repository.split("/").pop()}{" "}
								<span className="ml-1">
									{data.branchUrl
										? link(
												data.branchUrl,
												"branch",
												<span className="min-w-0 truncate">{data.branch}</span>,
											)
										: data.branch}
								</span>
							</span>
							{!pr && data.published === false && (
								<span>Task branch not on GitHub</span>
							)}
							{pr && (
								<>
									{pr.additions !== undefined && pr.deletions !== undefined && (
										<span
											className="cline-ui-pr-bar__counts shrink-0 tabular-nums"
											{...(onNavigate
												? {}
												: {
														role: "img",
														"aria-label": `${pr.additions} additions, ${pr.deletions} deletions`,
													})}
											title={`${pr.additions} additions, ${pr.deletions} deletions`}
										>
											<span className="cline-ui-pr-bar__tone--success text-green-500">
												+{pr.additions.toLocaleString()}
											</span>{" "}
											<span className="cline-ui-pr-bar__tone--failure text-red-400">
												−{pr.deletions.toLocaleString()}
											</span>
										</span>
									)}
									{renderChecks(
										<button
											type="button"
											className="cline-ui-pr-bar__check-trigger flex shrink-0 items-center gap-1.5 rounded-md bg-cline-ui-muted px-2 py-1"
											aria-label={
												ci === "none" ? "No CI checks" : checkLabels[ci]
											}
										>
											<span
												aria-hidden="true"
												className={`cline-ui-pr-bar__dot size-2 rounded-full ${checkColors[ci]}`}
												data-state={ci}
											/>
											{checkLabels[ci]}
											<ChevronDown className="size-3" />
										</button>,
										checksContent,
									)}
								</>
							)}
						</>
					) : (
						<span>Task branch unavailable.</span>
					))}
				<button
					type="button"
					disabled={loading}
					onClick={onRefresh}
					aria-label="Refresh pull request status"
					title="Refresh pull request status"
					className="cline-ui-pr-bar__refresh shrink-0 rounded p-1 text-cline-ui-muted-foreground hover:bg-cline-ui-muted disabled:opacity-50"
				>
					<RefreshCw
						className={`size-3 ${loading ? `animate-spin ${onNavigate ? "" : "motion-reduce:animate-none"}` : ""}`}
					/>
				</button>
			</div>
		</section>
	);
}
