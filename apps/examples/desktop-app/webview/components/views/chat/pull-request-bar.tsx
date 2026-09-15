"use client";

import {
	ChevronDown,
	ExternalLink,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	RefreshCw,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	getMergeStatus,
	type MergeStatus,
	type PullRequestStatus,
	summarizeChecks,
} from "@/lib/pull-request";
import { trackPullRequestEvent } from "@/lib/pull-request-telemetry";
import { cn } from "@/lib/utils";

const checkLabels = {
	none: "No checks",
	pending: "CI pending",
	success: "CI passed",
	failure: "CI failed",
	skipped: "CI skipped",
};
const checkColors = {
	none: "bg-muted-foreground",
	pending: "bg-yellow-500",
	success: "bg-green-500",
	failure: "bg-red-500",
	skipped: "bg-muted-foreground",
};

const mergeStatusColors: Record<MergeStatus["tone"], string> = {
	merged: "text-purple-400",
	failure: "text-red-400",
	warning: "text-yellow-500",
	neutral: "text-muted-foreground",
	success: "text-green-500",
};

export function PullRequestBar({
	cwd,
	branch,
}: {
	cwd: string;
	branch: string | null;
}) {
	// Remount on workspace/branch changes so another repository's PR never flashes.
	if (!cwd || !branch || branch === "no-git") return null;
	return <WorkspacePullRequestBar key={`${cwd}:${branch}`} cwd={cwd} />;
}

function WorkspacePullRequestBar({ cwd }: { cwd: string }) {
	const [data, setData] = useState<PullRequestStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const refresh = useRef<() => void>(() => {});
	const [loading, setLoading] = useState(false);
	const hasReportedShown = useRef(false);
	const hasLoadedStatus = useRef(false);
	const errorDismissed = useRef(false);

	useEffect(() => {
		if (hasReportedShown.current || document.visibilityState === "hidden")
			return;
		if (data?.pullRequest || data?.createUrl) {
			hasReportedShown.current = true;
			trackPullRequestEvent("shown", data);
		}
	}, [data]);

	useEffect(() => {
		let disposed = false;
		let inFlight = false;
		async function update() {
			if (inFlight || document.visibilityState === "hidden") return;
			inFlight = true;
			setLoading(true);
			try {
				const result = await desktopClient.invoke<PullRequestStatus | null>(
					"get_pull_request_status",
					{ cwd },
				);
				if (!disposed) {
					hasLoadedStatus.current = result !== null;
					errorDismissed.current = false;
					setData(result);
					setError(null);
				}
			} catch (cause) {
				if (!disposed) {
					setData(null);
					if (hasLoadedStatus.current && !errorDismissed.current) {
						setError(
							cause instanceof Error
								? cause.message
								: "Could not load pull request status.",
						);
					}
				}
			} finally {
				inFlight = false;
				if (!disposed) setLoading(false);
			}
		}
		refresh.current = () => void update();
		void update();
		const timer = window.setInterval(() => void update(), 30_000);
		const onFocus = () => void update();
		window.addEventListener("focus", onFocus);
		document.addEventListener("visibilitychange", onFocus);
		return () => {
			disposed = true;
			window.clearInterval(timer);
			window.removeEventListener("focus", onFocus);
			document.removeEventListener("visibilitychange", onFocus);
		};
	}, [cwd]);

	async function open(url: string) {
		try {
			await openExternalUrl(url);
		} catch {
			setError("Could not open GitHub in your browser. Try again.");
		}
	}

	const pr = data?.pullRequest;
	if (!error && !pr && !data?.createUrl) return null;
	const ci = summarizeChecks(pr?.checks ?? []);
	const Icon =
		pr?.state === "MERGED"
			? GitMerge
			: pr?.state === "CLOSED"
				? GitPullRequestClosed
				: pr?.isDraft
					? GitPullRequestDraft
					: GitPullRequest;
	const mergeStatus = pr ? getMergeStatus(pr) : null;
	const statusColor = mergeStatusColors[mergeStatus?.tone ?? "neutral"];

	return (
		<section
			className="border-b border-border px-4 py-2 text-xs"
			aria-label="Pull request status"
		>
			{error && (
				<div className="mb-1 flex items-start gap-2 text-muted-foreground">
					<output className="min-w-0 flex-1">{error}</output>
					<button
						type="button"
						aria-label="Dismiss pull request error"
						className="shrink-0 rounded p-1 hover:bg-muted"
						onClick={() => {
							errorDismissed.current = true;
							setError(null);
						}}
					>
						<X className="size-3" />
					</button>
				</div>
			)}
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				{data && (
					<>
						<Icon
							className={cn("size-4 shrink-0", statusColor)}
							aria-hidden="true"
						/>
						{pr ? (
							<>
								<button
									type="button"
									onClick={() => {
										trackPullRequestEvent("open_clicked", data);
										void open(pr.url);
									}}
									title={pr.title}
									className="shrink-0 font-medium hover:underline"
									aria-label={`Open pull request #${pr.number}: ${pr.title}`}
								>
									#{pr.number}
								</button>
								<span className={cn("shrink-0", statusColor)}>
									{mergeStatus?.label}
								</span>
							</>
						) : (
							<button
								type="button"
								className="shrink-0 font-medium hover:underline"
								title="Open GitHub’s comparison form for this branch. Push your commits before submitting."
								onClick={() => {
									if (data.createUrl) {
										trackPullRequestEvent("create_clicked", data);
										void open(data.createUrl);
									}
								}}
							>
								Create PR <ExternalLink className="inline size-3" />
							</button>
						)}
						<span
							className="min-w-0 flex-1 truncate text-muted-foreground"
							title={`${data.repository} · ${data.branch}`}
						>
							{data.repository.split("/").pop()}{" "}
							<span className="ml-1">{data.branch}</span>
						</span>
						{pr && (
							<>
								<span
									className="shrink-0 tabular-nums"
									title={`${pr.additions} additions, ${pr.deletions} deletions`}
								>
									<span className="text-green-500">
										+{pr.additions.toLocaleString()}
									</span>{" "}
									<span className="text-red-400">
										−{pr.deletions.toLocaleString()}
									</span>
								</span>
								<Popover
									onOpenChange={(isOpen) => {
										if (isOpen) trackPullRequestEvent("checks_expanded", data);
									}}
								>
									<PopoverTrigger asChild>
										<button
											type="button"
											className="flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1"
											aria-label={
												ci === "none" ? "No CI checks" : checkLabels[ci]
											}
										>
											<span
												className={cn("size-2 rounded-full", checkColors[ci])}
											/>
											{checkLabels[ci]}
											<ChevronDown className="size-3" />
										</button>
									</PopoverTrigger>
									<PopoverContent align="end" className="w-80 p-3">
										<p className="mb-2 text-sm font-medium">
											Checks for #{pr.number}
										</p>
										{!pr.checks.length && (
											<p className="text-xs text-muted-foreground">
												No checks reported for this pull request.
											</p>
										)}
										<ul className="max-h-64 space-y-2 overflow-y-auto">
											{pr.checks.map((check, index) => (
												<li
													key={`${check.name}:${index}`}
													className="flex items-center gap-2 text-xs"
												>
													<span
														className={cn(
															"size-2 shrink-0 rounded-full",
															checkColors[check.state],
														)}
													/>
													<span className="min-w-0 flex-1 break-words">
														{check.url ? (
															<button
																type="button"
																onClick={() => {
																	if (check.url) {
																		trackPullRequestEvent(
																			"check_clicked",
																			data,
																		);
																		void open(check.url);
																	}
																}}
																className="text-left hover:underline"
															>
																{check.name}{" "}
																<ExternalLink className="inline size-3" />
															</button>
														) : (
															check.name
														)}
													</span>
													<span className="text-muted-foreground">
														{check.state}
													</span>
												</li>
											))}
										</ul>
									</PopoverContent>
								</Popover>
							</>
						)}
					</>
				)}
				<button
					type="button"
					disabled={loading}
					onClick={() => {
						trackPullRequestEvent("refresh_clicked", data);
						refresh.current();
					}}
					aria-label="Refresh pull request status"
					title="Refresh pull request status"
					className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
				>
					<RefreshCw className={cn("size-3", loading && "animate-spin")} />
				</button>
			</div>
		</section>
	);
}
