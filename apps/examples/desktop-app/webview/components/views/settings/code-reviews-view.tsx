"use client";

import { Cloud, GitPullRequest, Laptop, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageEmptyState, PageFrame, PageHeader } from "../page-layout";

/**
 * Code Reviews: observational PR review for pull requests you're asked to
 * look at. Cline watches the PRs you choose, reads the diff and discussion,
 * and reports findings per PR — it does not produce a blended quality score.
 *
 * v0 scaffold: shell page with Inbox / History / Setup sub-tabs and
 * non-functional setup copy. The AutoReview pipeline, GitHub API integration,
 * and analyzer digests land in follow-up PRs.
 */

type CodeReviewsTab = "inbox" | "history" | "setup";

const CODE_REVIEWS_TABS: { id: CodeReviewsTab; label: string }[] = [
	{ id: "inbox", label: "Inbox" },
	{ id: "history", label: "History" },
	{ id: "setup", label: "Setup" },
];

export function CodeReviewsContent() {
	const [tab, setTab] = useState<CodeReviewsTab>("inbox");

	return (
		<PageFrame>
			<PageHeader
				description="Automated, observational review for pull requests you're asked to look at. Cline reads the diff and discussion and reports findings per PR — not a blended quality score."
				title="Code Reviews"
				actions={
					<>
						<Button
							aria-label="Refresh reviews"
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw className="h-4 w-4" />
						</Button>
						{/* Stub CTA: enabled once the review pipeline lands. */}
						<Button
							disabled
							size="sm"
							title="Coming soon — connect GitHub in Setup first"
							type="button"
						>
							<GitPullRequest className="h-4 w-4" />
							Review a PR
						</Button>
					</>
				}
			/>

			<div className="mb-6 flex items-center gap-0 border-b border-border">
				{CODE_REVIEWS_TABS.map((reviewsTab) => {
					const active = tab === reviewsTab.id;
					return (
						<Button
							aria-current={active ? "page" : undefined}
							className={cn(
								"relative rounded-none px-4 py-2.5 text-sm font-medium transition-colors",
								active
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							key={reviewsTab.id}
							onClick={() => setTab(reviewsTab.id)}
							type="button"
							variant="ghost"
						>
							{reviewsTab.label}
							{active ? (
								<span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />
							) : null}
						</Button>
					);
				})}
			</div>

			{tab === "inbox" ? (
				<PageEmptyState>
					No reviews yet. Once GitHub is connected, PRs where your review is
					requested show up here with Cline's findings.
				</PageEmptyState>
			) : tab === "history" ? (
				<PageEmptyState>
					Completed reviews will appear here, grouped by pull request.
				</PageEmptyState>
			) : (
				<CodeReviewsSetupStub />
			)}
		</PageFrame>
	);
}

/**
 * Non-functional setup copy for v0: shows what configuring Code Reviews will
 * involve (GitHub connection, repository selection, where reviews run)
 * without wiring any of it up yet.
 */
function CodeReviewsSetupStub() {
	return (
		<section className="max-w-344">
			<div className="flex items-center justify-between gap-5 border-b py-4 max-[720px]:flex-col max-[720px]:items-stretch">
				<div className="flex flex-col gap-1">
					<p className="flex items-center gap-2 text-base font-semibold text-foreground">
						GitHub connection
						<Badge variant="secondary">Coming soon</Badge>
					</p>
					<p className="text-sm text-muted-foreground">
						Connect a GitHub account so Cline can see the pull requests where
						your review is requested.
					</p>
				</div>
				<Button
					className="shrink-0"
					disabled
					size="sm"
					type="button"
					variant="outline"
				>
					Connect GitHub
				</Button>
			</div>
			<div className="flex items-center justify-between gap-5 border-b py-4 max-[720px]:flex-col max-[720px]:items-stretch">
				<div className="flex flex-col gap-1">
					<p className="flex items-center gap-2 text-base font-semibold text-foreground">
						Repositories
						<Badge variant="secondary">Coming soon</Badge>
					</p>
					<p className="text-sm text-muted-foreground">
						Choose which repositories Code Reviews watches for incoming review
						requests.
					</p>
				</div>
				<Button
					className="shrink-0"
					disabled
					size="sm"
					type="button"
					variant="outline"
				>
					Choose repositories
				</Button>
			</div>
			<div className="flex items-center justify-between gap-5 py-4 max-[720px]:flex-col max-[720px]:items-stretch">
				<div className="flex flex-col gap-1">
					<p className="flex items-center gap-2 text-base font-semibold text-foreground">
						Where reviews run
						<Badge variant="secondary">Coming soon</Badge>
					</p>
					<p className="text-sm text-muted-foreground">
						Run reviews on this machine with your local checkout, or in a cloud
						sandbox without tying up your computer.
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button disabled size="sm" type="button" variant="outline">
						<Laptop className="h-4 w-4" />
						This machine
					</Button>
					<Button disabled size="sm" type="button" variant="outline">
						<Cloud className="h-4 w-4" />
						Cloud
					</Button>
				</div>
			</div>
		</section>
	);
}
