"use client";

import {
	ArrowRight,
	BookOpen,
	Check,
	Cloud,
	ExternalLink,
	Github,
	Loader2,
	RefreshCw,
	ShieldCheck,
	Sparkles,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";

const DOCS_URL = "https://docs.cline.bot";

/**
 * First-run walkthrough shown when the signed-in account has not connected
 * GitHub on the Cline dashboard yet. Cloud sessions clone a repository into a
 * sandbox, so the GitHub app installation is a hard prerequisite.
 */
export function CloudOnboarding({
	connectUrl,
	onRefresh,
	refreshing,
	organizationName,
}: {
	connectUrl: string;
	onRefresh: () => void | Promise<void>;
	refreshing: boolean;
	organizationName?: string;
}) {
	const [openedDashboard, setOpenedDashboard] = useState(false);

	const openDashboard = () => {
		setOpenedDashboard(true);
		void openExternalUrl(connectUrl);
	};

	return (
		<div className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-6 py-12">
			<div className="w-full max-w-2xl">
				<ConnectionDiagram />

				<h1 className="mt-8 text-center text-[28px] font-semibold leading-tight text-foreground">
					Connect GitHub to start Cloud Sessions
				</h1>
				<p className="mx-auto mt-3 max-w-xl text-center text-[15px] leading-6 text-muted-foreground">
					Cloud Sessions run Cline on your repositories in a secure sandbox in
					the cloud — start a task from your desk, close the app, and check back
					when it&apos;s done. To get started, connect
					{organizationName ? ` ${organizationName}'s` : " your"} GitHub account
					on the Cline dashboard.
				</p>

				<ol className="mx-auto mt-10 flex max-w-xl flex-col gap-4">
					<OnboardingStep
						index={1}
						title="Open the Cline dashboard"
						description="Sign in with the same Cline account you use in this app, then go to the Integrations page."
						action={
							<Button onClick={openDashboard} type="button">
								<ExternalLink className="size-4" />
								Open Integrations
							</Button>
						}
						done={openedDashboard}
					/>
					<OnboardingStep
						index={2}
						title="Connect GitHub and install the Cline app"
						description="Click Connect next to GitHub and pick the repositories Cline may work on. You can change the selection at any time on GitHub."
					/>
					<OnboardingStep
						index={3}
						title="Come back and refresh"
						description="Once GitHub shows as connected on the dashboard, refresh here to pick a repository and start your first cloud session."
						action={
							<Button
								disabled={refreshing}
								onClick={() => void onRefresh()}
								type="button"
								variant="outline"
							>
								{refreshing ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<RefreshCw className="size-4" />
								)}
								{refreshing ? "Checking..." : "I've connected it"}
							</Button>
						}
					/>
				</ol>

				<div className="mt-12 grid grid-cols-3 gap-3 max-[720px]:grid-cols-1">
					<FeatureCard
						icon={Zap}
						title="Runs while you're away"
						description="Sessions keep working in the cloud after you close the app."
					/>
					<FeatureCard
						icon={ShieldCheck}
						title="Isolated sandboxes"
						description="Each session gets its own environment with scoped repository access."
					/>
					<FeatureCard
						icon={Sparkles}
						title="Same Cline experience"
						description="Live streaming, tool approvals, and full transcripts — just like local sessions."
					/>
				</div>

				<div className="mt-10 flex items-center justify-center">
					<button
						className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
						onClick={() => void openExternalUrl(DOCS_URL)}
						type="button"
					>
						<BookOpen className="size-4" />
						Learn more about how Cloud Sessions work
						<ArrowRight className="size-3.5" />
					</button>
				</div>
			</div>
		</div>
	);
}

/** GitHub → Cline cloud visual, theme-aware and dependency-free. */
function ConnectionDiagram() {
	return (
		<div className="flex items-center justify-center gap-6">
			<div className="flex size-20 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
				<Github aria-hidden="true" className="size-10 text-foreground" />
			</div>
			<svg
				aria-hidden="true"
				className="h-6 w-24 text-muted-foreground/70"
				fill="none"
				viewBox="0 0 96 24"
			>
				<path
					d="M2 12h84"
					stroke="currentColor"
					strokeDasharray="6 6"
					strokeLinecap="round"
					strokeWidth="2"
				>
					<animate
						attributeName="stroke-dashoffset"
						dur="1.2s"
						from="12"
						repeatCount="indefinite"
						to="0"
					/>
				</path>
				<path
					d="M86 6l8 6-8 6"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="2"
				/>
			</svg>
			<div className="flex size-20 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 shadow-sm">
				<Cloud aria-hidden="true" className="size-10 text-primary" />
			</div>
		</div>
	);
}

function OnboardingStep({
	index,
	title,
	description,
	action,
	done,
}: {
	index: number;
	title: string;
	description: string;
	action?: React.ReactNode;
	done?: boolean;
}) {
	return (
		<li className="flex items-start gap-4 rounded-xl border border-border bg-card p-4">
			<span
				className={cn(
					"mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
					done
						? "bg-primary text-primary-foreground"
						: "bg-muted text-muted-foreground",
				)}
			>
				{done ? <Check className="size-4" /> : index}
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-[15px] font-medium text-foreground">{title}</p>
				<p className="mt-1 text-sm leading-5 text-muted-foreground">
					{description}
				</p>
				{action ? <div className="mt-3">{action}</div> : null}
			</div>
		</li>
	);
}

function FeatureCard({
	icon: Icon,
	title,
	description,
}: {
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	description: string;
}) {
	return (
		<div className="rounded-xl border border-border bg-card p-4">
			<Icon className="size-5 text-primary" />
			<p className="mt-2.5 text-sm font-medium text-foreground">{title}</p>
			<p className="mt-1 text-[13px] leading-5 text-muted-foreground">
				{description}
			</p>
		</div>
	);
}
