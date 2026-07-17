"use client";

import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AuroraBackground } from "@/components/ui/aurora-bg";
import { useWorkspace } from "@/contexts/workspace-context";
import { cn } from "@/lib/utils";
import { WelcomeWorkspaceControls } from "./welcome-workspace-controls";

interface QuickAction {
	id: string;
	label: string;
	description: string;
	prompt: string;
}

const HERO_VERBS = ["build", "create", "fix", "know"] as const;
const HERO_CYCLE_MS = 2600;

const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
	{
		id: "review-changes",
		label: "Review changes",
		description: "Review the current changes and call out anything risky.",
		prompt: "Review the current changes and call out anything risky.",
	},
	{
		id: "check-build",
		label: "Check for build errors",
		description: "Run the relevant checks and help me fix any failures.",
		prompt: "Check this project for build errors and help me fix any failures.",
	},
];

function HeroHeading() {
	const [verbIndex, setVerbIndex] = useState(0);

	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		if (media.matches) return;
		const interval = setInterval(() => {
			setVerbIndex((prev) => (prev + 1) % HERO_VERBS.length);
		}, HERO_CYCLE_MS);
		return () => clearInterval(interval);
	}, []);

	const verb = HERO_VERBS[verbIndex];

	return (
		<h1
			id="hero-header"
			className="text-balance text-left text-[clamp(2rem,3vw,2.6rem)] font-semibold leading-[1.12] tracking-tight text-foreground"
		>
			<span className="sr-only">What would you like to build?</span>
			<span aria-hidden="true">
				What would you like to{" "}
				{/* key remounts the word each cycle so the chars re-trigger their entrance */}
				<span key={verb}>
					{verb.split("").map((char, index) => (
						<span
							className="hero-word-char"
							// biome-ignore lint/suspicious/noArrayIndexKey: the word remounts via the parent key each cycle, so char position is a stable, non-reordering identity
							key={`${verb}-${index}`}
							style={{ animationDelay: `${index * 45}ms` }}
						>
							{char}
						</span>
					))}
				</span>
				?
			</span>
		</h1>
	);
}

export function WelcomeScreen({
	active,
	body,
	composer,
	onStartChat,
	quickActions,
	gitBranch,
	onListGitBranches,
	onSwitchGitBranch,
}: {
	active: boolean;
	body: ReactNode;
	composer: ReactNode;
	onStartChat: (prompt: string) => void;
	quickActions: QuickAction[];
	gitBranch: string;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
}) {
	const {
		workspaceRoot,
		workspaces,
		refreshWorkspaces,
		switchWorkspace,
		pickWorkspaceDirectory,
	} = useWorkspace();
	const actions =
		quickActions.length > 0 ? quickActions : DEFAULT_QUICK_ACTIONS;

	useEffect(() => {
		if (active) void refreshWorkspaces();
	}, [active, refreshWorkspaces]);

	return (
		<div
			className={cn(
				active
					? "relative h-full min-h-0 overflow-hidden bg-background"
					: "contents",
			)}
		>
			{active ? <AuroraBackground /> : null}
			<div
				className={cn(
					active
						? "relative z-10 h-full w-full overflow-x-hidden overflow-y-auto"
						: "contents",
				)}
			>
				<div
					className={cn(
						active
							? "mx-auto flex w-full max-w-240 flex-col px-6 pb-32 pt-[clamp(8rem,26vh,17rem)] max-[720px]:px-4 max-[720px]:pb-20 max-[720px]:pt-16"
							: "contents",
					)}
				>
					{active ? (
						<>
							<HeroHeading />

							<div className="mt-11 flex min-w-0 items-center">
								<WelcomeWorkspaceControls
									currentBranch={gitBranch}
									onListGitBranches={onListGitBranches}
									onPickWorkspaceDirectory={pickWorkspaceDirectory}
									onRefreshWorkspaces={refreshWorkspaces}
									onSwitchGitBranch={onSwitchGitBranch}
									onSwitchWorkspace={switchWorkspace}
									workspaceRoot={workspaceRoot}
									workspaces={workspaces}
								/>
							</div>
						</>
					) : null}

					<div
						className={active ? "hidden" : "h-full min-h-0 overflow-hidden"}
						key="conversation-body"
					>
						{body}
					</div>

					<div
						className={active ? "mt-4 w-full" : "z-20 shrink-0"}
						key="persistent-composer"
					>
						{composer}
					</div>

					{active ? (
						<div className="mt-11 w-full divide-y divide-border/80 overflow-hidden rounded-xl border border-border/60 bg-background/95 px-2 shadow-sm">
							{actions.map((action) => (
								<button
									className="group flex w-full items-center justify-between gap-5 px-3 py-3 text-left transition-colors hover:bg-background/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
									key={action.id}
									onClick={() => onStartChat(action.prompt)}
									type="button"
								>
									<span className="min-w-0">
										<span className="block text-[15px] font-medium text-foreground">
											{action.label}
										</span>
										<span className="mt-0.5 block truncate text-sm text-muted-foreground">
											{action.description}
										</span>
									</span>
									<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
										<ArrowRight className="size-3" />
									</span>
								</button>
							))}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
