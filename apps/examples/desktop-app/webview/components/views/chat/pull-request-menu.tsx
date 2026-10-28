"use client";

import { GitHubIcon } from "@cline/ui";
import {
	ArrowUpRight,
	ChevronDown,
	CircleCheck,
	CircleDashed,
	CircleMinus,
	CircleX,
	Copy,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestCreateArrow,
	GitPullRequestDraft,
	RefreshCw,
	TriangleAlert,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	getMergeStatus,
	type PullRequestCheck,
	type PullRequestStatus,
	summarizeChecks,
} from "@/lib/pull-request";
import { trackPullRequestEvent } from "@/lib/pull-request-telemetry";
import { cn } from "@/lib/utils";

type PullRequest = NonNullable<PullRequestStatus["pullRequest"]>;

const toneColors = {
	merged: "text-purple-400",
	failure: "text-red-400",
	warning: "text-yellow-500",
	neutral: "text-muted-foreground",
	success: "text-green-500",
};
const checkDotColors = {
	none: "bg-muted-foreground",
	pending: "bg-yellow-500",
	success: "bg-green-500",
	failure: "bg-red-500",
	skipped: "bg-muted-foreground",
};

const checkOrder = { failure: 0, pending: 1, success: 2, skipped: 3 };

function pullRequestIcon(pr: PullRequest) {
	if (pr.state === "MERGED") return GitMerge;
	if (pr.state === "CLOSED") return GitPullRequestClosed;
	if (pr.isDraft) return GitPullRequestDraft;
	return GitPullRequest;
}

function checksLabel(checks: PullRequestCheck[]) {
	const count = (state: PullRequestCheck["state"]) =>
		checks.filter((check) => check.state === state).length;
	switch (summarizeChecks(checks)) {
		case "failure":
			return `${count("failure")} of ${checks.length} checks failed`;
		case "pending":
			return `${count("pending")} of ${checks.length} checks running`;
		case "success":
			return "All checks passed";
		case "skipped":
			return "Checks skipped";
		default:
			return "No checks";
	}
}

function CheckStateIcon({ state }: { state: PullRequestCheck["state"] }) {
	if (state === "success") return <CircleCheck className="text-green-500" />;
	if (state === "failure") return <CircleX className="text-red-400" />;
	if (state === "pending") return <CircleDashed className="text-yellow-500" />;
	return <CircleMinus className="text-muted-foreground" />;
}

/** Header button for the branch's pull request; hidden when there is nothing to show. */
export function PullRequestMenu({
	cwd,
	branch,
}: {
	cwd: string;
	branch: string | null;
}) {
	// Remount on workspace/branch changes so another repository's PR never flashes.
	if (!cwd || !branch || branch === "no-git") return null;
	return <WorkspacePullRequestMenu key={`${cwd}:${branch}`} cwd={cwd} />;
}

function WorkspacePullRequestMenu({ cwd }: { cwd: string }) {
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
			toast({
				variant: "destructive",
				title: "Could not open the link",
				description: "Your browser did not open. Try again.",
			});
		}
	}

	async function copyBranch(branch: string) {
		try {
			await navigator.clipboard.writeText(branch);
			toast({ title: "Branch name copied" });
		} catch {
			toast({
				variant: "destructive",
				title: "Copy failed",
				description: "The branch name could not be copied to the clipboard.",
			});
		}
	}

	const pr = data?.pullRequest;
	if (!error && !pr && !data?.createUrl) return null;

	const status = pr ? getMergeStatus(pr) : null;
	const ci = summarizeChecks(pr?.checks ?? []);
	const PrIcon = pr ? pullRequestIcon(pr) : GitPullRequestCreateArrow;
	const triggerLabel = pr
		? `Pull request #${pr.number}: ${status?.label}`
		: error
			? "Pull request status unavailable"
			: "Create a pull request";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={triggerLabel}
					className="h-7 gap-1.5 px-2 text-xs"
					id="pull-request-menu"
					size="sm"
					title={pr?.title ?? triggerLabel}
					type="button"
					variant="toolbar"
				>
					{error && !pr ? (
						<TriangleAlert className="size-3.5 text-yellow-500" />
					) : (
						<PrIcon
							className={cn(
								"size-3.5",
								status ? toneColors[status.tone] : undefined,
							)}
						/>
					)}
					{pr ? (
						<span className="font-mono text-foreground">#{pr.number}</span>
					) : null}
					{pr?.state === "OPEN" && ci !== "none" ? (
						<span
							aria-hidden="true"
							className={cn("size-1.5 rounded-full", checkDotColors[ci])}
							data-state={ci}
						/>
					) : null}
					<ChevronDown className="size-3" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				{pr && status ? (
					<>
						<div className="flex gap-2.5 px-2 py-1.5">
							<PrIcon
								className={cn(
									"mt-0.5 size-4 shrink-0",
									toneColors[status.tone],
								)}
							/>
							<div className="min-w-0">
								<p className="line-clamp-2 text-sm font-medium">{pr.title}</p>
								<p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
									<span className="font-mono">#{pr.number}</span>
									<span aria-hidden="true">·</span>
									<span className={toneColors[status.tone]}>
										{status.label}
									</span>
									<span aria-hidden="true">·</span>
									<span className="font-mono tabular-nums">
										<span className="text-chart-2">
											+{pr.additions.toLocaleString()}
										</span>{" "}
										<span className="text-destructive">
											-{pr.deletions.toLocaleString()}
										</span>
									</span>
								</p>
							</div>
						</div>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onSelect={() => {
								trackPullRequestEvent("open_clicked", data);
								void open(pr.url);
							}}
						>
							<GitHubIcon />
							Open on GitHub
							<ArrowUpRight className="ml-auto" />
						</DropdownMenuItem>
						{pr.checks.length > 0 ? (
							<DropdownMenuSub
								onOpenChange={(isOpen) => {
									if (isOpen) trackPullRequestEvent("checks_expanded", data);
								}}
							>
								<DropdownMenuSubTrigger>
									<span
										aria-hidden="true"
										className="flex size-4 items-center justify-center"
									>
										<span
											className={cn("size-2 rounded-full", checkDotColors[ci])}
										/>
									</span>
									{checksLabel(pr.checks)}
								</DropdownMenuSubTrigger>
								{/* Portaled so the main menu's scroll container doesn't clip it. */}
								<DropdownMenuPortal>
									<DropdownMenuSubContent className="max-h-72 w-64 overflow-y-auto">
										{[...pr.checks]
											.sort((a, b) => checkOrder[a.state] - checkOrder[b.state])
											.map((check, index) => (
												<DropdownMenuItem
													disabled={!check.url}
													// biome-ignore lint/suspicious/noArrayIndexKey: check names repeat across matrix jobs.
													key={`${check.name}:${index}`}
													onSelect={() => {
														if (!check.url) return;
														trackPullRequestEvent("check_clicked", data);
														void open(check.url);
													}}
												>
													<CheckStateIcon state={check.state} />
													<span
														className="min-w-0 flex-1 truncate"
														title={check.name}
													>
														{check.name}
													</span>
													<span className="text-xs text-muted-foreground">
														{check.state}
													</span>
												</DropdownMenuItem>
											))}
									</DropdownMenuSubContent>
								</DropdownMenuPortal>
							</DropdownMenuSub>
						) : (
							<DropdownMenuItem disabled>
								<CircleMinus />
								No checks
							</DropdownMenuItem>
						)}
					</>
				) : error ? (
					<>
						<p className="px-2 py-1.5 text-xs text-muted-foreground">{error}</p>
						<DropdownMenuItem
							onSelect={() => {
								errorDismissed.current = true;
								setError(null);
							}}
						>
							<X />
							Dismiss
						</DropdownMenuItem>
					</>
				) : data?.createUrl ? (
					<>
						<p className="px-2 py-1.5 text-xs text-muted-foreground">
							No pull request for this branch yet.
						</p>
						<DropdownMenuItem
							onSelect={() => {
								trackPullRequestEvent("create_clicked", data);
								if (data.createUrl) void open(data.createUrl);
							}}
							title="Open GitHub’s comparison form for this branch. Push your commits before submitting."
						>
							<GitPullRequestCreateArrow />
							Create pull request
							<ArrowUpRight className="ml-auto" />
						</DropdownMenuItem>
					</>
				) : null}
				<DropdownMenuSeparator />
				{data?.branch ? (
					<DropdownMenuItem onSelect={() => void copyBranch(data.branch)}>
						<Copy />
						Copy branch name
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem
					disabled={loading}
					onSelect={(event) => {
						// Stay open so the refreshed status replaces the stale one in place.
						event.preventDefault();
						trackPullRequestEvent("refresh_clicked", data);
						refresh.current();
					}}
				>
					<RefreshCw className={cn(loading && "animate-spin")} />
					Refresh status
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
