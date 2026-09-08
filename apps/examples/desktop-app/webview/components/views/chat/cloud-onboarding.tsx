"use client";

import {
	ArrowRight,
	Check,
	Cloud,
	ExternalLink,
	GitBranch,
	Github,
	LoaderCircle,
	LogIn,
	RefreshCcw,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CloudOnboardingVariant =
	| "signed_out"
	| "not_connected"
	| "no_repositories"
	| "error";

/**
 * Full-width onboarding panel shown in place of the composer when a cloud
 * session cannot be started yet (signed out, GitHub not connected, or the
 * GitHub App has no repository access). Teaches what cloud sessions are and
 * walks the user through the dashboard hand-off, then auto-detects completion.
 */
export function CloudOnboardingCard({
	variant,
	onConnect,
	onRefresh,
	onSignIn,
	signingIn = false,
	checking = false,
}: {
	variant: CloudOnboardingVariant;
	/** Opens the Cline dashboard integrations page in the browser. */
	onConnect: () => void;
	onRefresh: () => void;
	onSignIn?: () => void;
	signingIn?: boolean;
	/** True while a background repository re-check is in flight. */
	checking?: boolean;
}) {
	if (variant === "error") {
		return (
			<div className="rounded-xl border border-border bg-card/80 p-6 text-center shadow-sm backdrop-blur-sm">
				<p className="text-sm font-medium text-foreground">
					Could not reach Cline Cloud
				</p>
				<p className="mt-1 text-sm text-muted-foreground">
					Check your connection and try again.
				</p>
				<Button
					className="mt-4"
					disabled={checking}
					onClick={onRefresh}
					size="sm"
					variant="outline"
				>
					<RefreshCcw
						aria-hidden="true"
						className={cn("size-3.5", checking && "animate-spin")}
					/>
					Retry
				</Button>
			</div>
		);
	}

	const isSignedOut = variant === "signed_out";
	const isNoRepositories = variant === "no_repositories";

	return (
		<div className="overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur-sm">
			<div className="flex flex-col gap-6 p-6 max-[720px]:p-5">
				<div className="flex items-start justify-between gap-6 max-[720px]:flex-col">
					<div className="min-w-0">
						<p className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-primary">
							<Sparkles aria-hidden="true" className="size-3" />
							Cloud sessions
						</p>
						<h2 className="mt-3 text-lg font-semibold text-foreground">
							{isSignedOut
								? "Run Cline in the cloud"
								: isNoRepositories
									? "Give Cline access to a repository"
									: "Connect GitHub to get started"}
						</h2>
						<p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
							Cloud sessions run on secure, isolated sandboxes on Cline's
							infrastructure. Cline clones your repository, works on a branch,
							and keeps going even when you close the app — check back in from
							any device.
						</p>
					</div>
					<CloudFlowIllustration className="shrink-0 max-[720px]:self-center" />
				</div>

				<ol className="grid grid-cols-3 gap-3 max-[720px]:grid-cols-1">
					{isSignedOut ? (
						<OnboardingStep
							icon={<LogIn aria-hidden="true" className="size-4" />}
							index={1}
							title="Sign in with Cline"
						>
							Cloud sessions are part of your Cline account.
						</OnboardingStep>
					) : (
						<OnboardingStep
							done={isNoRepositories}
							icon={<Github aria-hidden="true" className="size-4" />}
							index={1}
							title="Connect GitHub"
						>
							Link your GitHub account from the Cline dashboard.
						</OnboardingStep>
					)}
					<OnboardingStep
						active={isNoRepositories}
						icon={<ShieldCheck aria-hidden="true" className="size-4" />}
						index={2}
						title="Pick your repositories"
					>
						Choose which repositories the Cline GitHub App can access.
					</OnboardingStep>
					<OnboardingStep
						icon={<GitBranch aria-hidden="true" className="size-4" />}
						index={3}
						title="Start a session"
					>
						Pick a repo and branch here, describe the task, and Cline gets to
						work in the cloud.
					</OnboardingStep>
				</ol>

				<div className="flex flex-wrap items-center gap-3">
					{isSignedOut ? (
						<Button disabled={signingIn} onClick={onSignIn} size="sm">
							<LogIn aria-hidden="true" className="size-3.5" />
							{signingIn ? "Waiting for browser…" : "Sign in with Cline"}
						</Button>
					) : (
						<Button onClick={onConnect} size="sm">
							<Github aria-hidden="true" className="size-3.5" />
							{isNoRepositories ? "Manage repository access" : "Connect GitHub"}
							<ExternalLink aria-hidden="true" className="size-3" />
						</Button>
					)}
					{isSignedOut ? null : (
						<Button
							disabled={checking}
							onClick={onRefresh}
							size="sm"
							variant="ghost"
						>
							<RefreshCcw
								aria-hidden="true"
								className={cn("size-3.5", checking && "animate-spin")}
							/>
							{isNoRepositories ? "Check again" : "I've connected GitHub"}
						</Button>
					)}
					{isSignedOut ? null : (
						<span
							aria-live="polite"
							className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
						>
							<LoaderCircle
								aria-hidden="true"
								className="size-3 animate-spin motion-reduce:animate-none"
							/>
							Watching for changes — this updates automatically.
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

function OnboardingStep({
	index,
	title,
	icon,
	children,
	done = false,
	active = false,
}: {
	index: number;
	title: string;
	icon: ReactNode;
	children: ReactNode;
	/** Step already completed (e.g. GitHub connected, repos pending). */
	done?: boolean;
	/** The step the user should do next. */
	active?: boolean;
}) {
	return (
		<li
			className={cn(
				"rounded-lg border border-border/70 bg-background/60 p-3.5",
				active && "border-primary/40 bg-primary/5",
			)}
		>
			<div className="flex items-center gap-2">
				<span
					className={cn(
						"inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
						done
							? "bg-success/15 text-success"
							: active
								? "bg-primary text-white"
								: "bg-muted text-muted-foreground",
					)}
				>
					{done ? <Check aria-hidden="true" className="size-3.5" /> : index}
				</span>
				<span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
					{icon}
					{title}
				</span>
			</div>
			<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
				{children}
			</p>
		</li>
	);
}

/**
 * Decorative GitHub → Cline Cloud → branch flow diagram. Built from theme
 * tokens so it adapts to light/dark mode and the accent color.
 */
function CloudFlowIllustration({ className }: { className?: string }) {
	return (
		<div
			aria-hidden="true"
			className={cn("flex items-center gap-2.5", className)}
		>
			<IllustrationNode>
				<Github className="size-5 text-foreground" />
			</IllustrationNode>
			<ArrowRight className="size-3.5 text-muted-foreground/70" />
			<IllustrationNode emphasized>
				<Cloud className="size-6 text-primary" />
			</IllustrationNode>
			<ArrowRight className="size-3.5 text-muted-foreground/70" />
			<IllustrationNode>
				<GitBranch className="size-5 text-foreground" />
			</IllustrationNode>
		</div>
	);
}

function IllustrationNode({
	children,
	emphasized = false,
}: {
	children: ReactNode;
	emphasized?: boolean;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center justify-center rounded-2xl border shadow-sm",
				emphasized
					? "size-14 border-primary/30 bg-primary/10"
					: "size-11 border-border/70 bg-background/80",
			)}
		>
			{children}
		</span>
	);
}
