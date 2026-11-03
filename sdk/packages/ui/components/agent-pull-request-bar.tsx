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
import { Badge } from "./badge.js";
import { Button, IconButton } from "./button.js";

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
const statusStyles = {
	merged: { tone: "accent", colorClassName: "text-cline-ui-accent-foreground" },
	failure: { tone: "error", colorClassName: "text-cline-ui-error-text" },
	warning: { tone: "warning", colorClassName: "text-cline-ui-warning-text" },
	neutral: {
		tone: "neutral",
		colorClassName: "text-cline-ui-muted-foreground",
	},
	success: { tone: "success", colorClassName: "text-cline-ui-success-text" },
} as const;
const checkColors = {
	unavailable: "bg-cline-ui-muted-foreground",
	none: "bg-cline-ui-muted-foreground",
	pending: "bg-cline-ui-warning-solid",
	success: "bg-cline-ui-success-solid",
	failure: "bg-cline-ui-error-solid",
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
	const statusStyle = statusStyles[status?.tone ?? "neutral"];
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
	) => (
		<Button
			asChild
			size="xs"
			tone="neutral"
			variant="ghost"
			className={`cline-ui-pr-bar__link h-auto min-w-0 whitespace-normal px-0 text-left hover:underline ${action === "open" || action === "create" ? "shrink-0 font-medium" : "shrink"}`}
			trailingIcon={
				action === "create" || action === "check" ? ExternalLink : undefined
			}
		>
			{onNavigate ? (
				<button
					type="button"
					title={title}
					aria-label={label}
					onClick={() => onNavigate(url, action)}
				>
					{children}
				</button>
			) : (
				<a
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					title={title}
					aria-label={label}
				>
					{children}
				</a>
			)}
		</Button>
	);
	const checksContent = (
		<div
			className="cline-ui-pr-bar__checks p-3"
			data-native-navigation={onNavigate ? true : undefined}
		>
			<p className="cline-ui-pr-bar__checks-title mb-2 font-medium text-cline-ui-sm">
				Checks for #{pr?.number}
			</p>
			{ci === "unavailable" ? (
				<p className="text-cline-ui-muted-foreground text-cline-ui-xs">
					Checks could not be loaded. Refresh to try again.
				</p>
			) : ci === "none" ? (
				<p className="text-cline-ui-muted-foreground text-cline-ui-xs">
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
			className="cline-ui-pr-bar border-cline-ui-border border-b px-4 py-2 text-cline-ui-xs"
			aria-label="Pull request status"
			data-native-navigation={onNavigate ? true : undefined}
		>
			{error && (
				<div className="cline-ui-pr-bar__error mb-1 flex items-start gap-2 text-cline-ui-error-text">
					<output className="min-w-0 flex-1">{error}</output>
					{onDismissError && (
						<IconButton
							aria-label="Dismiss pull request error"
							size="xs"
							icon={X}
							onClick={onDismissError}
						/>
					)}
				</div>
			)}
			<div className="cline-ui-pr-bar__row flex min-w-0 flex-wrap items-center gap-2">
				{data &&
					(data.branch ? (
						<>
							<PullRequestIcon
								className={`cline-ui-pr-bar__icon size-4 shrink-0 cline-ui-pr-bar__tone--${status?.tone ?? "neutral"} ${statusStyle.colorClassName}`}
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
									<Badge
										className={`cline-ui-pr-bar__tone--${status?.tone}`}
										size="xs"
										tone={statusStyle.tone}
										variant="ghost"
									>
										{status?.label}
									</Badge>
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
											<span className="cline-ui-pr-bar__tone--success text-cline-ui-success-text">
												+{pr.additions.toLocaleString()}
											</span>{" "}
											<span className="cline-ui-pr-bar__tone--failure text-cline-ui-error-text">
												−{pr.deletions.toLocaleString()}
											</span>
										</span>
									)}
									{renderChecks(
										<Badge
											interactive
											size="xs"
											className="cline-ui-pr-bar__check-trigger"
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
										</Badge>,
										checksContent,
									)}
								</>
							)}
						</>
					) : (
						<span>Task branch unavailable.</span>
					))}
				<IconButton
					size="xs"
					disabled={loading}
					onClick={onRefresh}
					aria-label="Refresh pull request status"
					title="Refresh pull request status"
					className="cline-ui-pr-bar__refresh"
				>
					<RefreshCw
						className={`size-3 ${loading ? `animate-spin ${onNavigate ? "" : "motion-reduce:animate-none"}` : ""}`}
					/>
				</IconButton>
			</div>
		</section>
	);
}
