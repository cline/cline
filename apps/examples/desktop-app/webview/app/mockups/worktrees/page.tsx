"use client";

/**
 * Design exploration: starting a task in a git worktree from the desktop app.
 *
 * Static mockups only. Nothing here talks to the sidecar; every panel is
 * rendered from hard-coded data so each concept can be screenshotted and
 * discussed. Open at /mockups/worktrees?concept=a|b|c|d.
 */

import { AgentWelcomeHero } from "@cline/ui";
import {
	ArrowUp,
	Brain,
	Check,
	ChevronDown,
	Copy,
	ExternalLink,
	Folder,
	FolderGit2,
	GitBranch,
	GitMerge,
	GitPullRequest,
	Paperclip,
	Plus,
	Search,
	Sparkles,
	SquarePen,
	Terminal,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { applyHubTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type ConceptId = "a" | "b" | "c" | "d";

const CONCEPTS: {
	id: ConceptId;
	title: string;
	summary: string;
}[] = [
	{
		id: "a",
		title: "A · “Run in” chip",
		summary:
			"A third chip next to Workspace and Branch on the welcome screen. Explicit, discoverable, and the natural home for defaults (“remember for this workspace”).",
	},
	{
		id: "b",
		title: "B · Branch chip does double duty",
		summary:
			"No new chrome. The existing branch picker grows a “new worktree” action, a list of existing worktrees, and a per-branch “open in worktree” affordance.",
	},
	{
		id: "c",
		title: "C · Split send button",
		summary:
			"Zero chrome until you need it. The send button gets a menu (and a shortcut) for “start in a new worktree”. The branch name is derived from the prompt.",
	},
	{
		id: "d",
		title: "D · Living in a worktree",
		summary:
			"What a task looks like after it started in a worktree: a worktree chip in the composer with lifecycle actions, and a glyph in the sidebar.",
	},
];

const REPO = "cline";
const REPO_PATH = "~/dev/cline";
const BRANCH = "main";
const BRANCHES = ["main", "develop", "release/1.2", "saoud/settings-polish"];
const WORKTREES = [
	{
		branch: "cline/fix-login-flow",
		path: "~/.cline/worktrees/a1b2c/cline",
		meta: "2 sessions · 3 commits ahead of main",
	},
	{
		branch: "cline/upgrade-deps",
		path: "~/.cline/worktrees/9f3e1/cline",
		meta: "1 session · idle 4d",
	},
];

// Mirrors welcome-workspace-controls.tsx so the chips read as the real thing.
const TRIGGER_CLASS =
	"inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/80 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-hover";
const PANEL_CLASS =
	"absolute left-0 top-full z-50 mt-2 rounded-lg border border-border bg-popover shadow-xl";
const ROW_CLASS =
	"flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-foreground hover:bg-surface-hover";
const ACTIVE_ROW_CLASS = "bg-(--accent-4) hover:bg-(--accent-4)";

function Chip({
	icon,
	label,
	open,
	chevron,
	className,
}: {
	icon: ReactNode;
	label: string;
	open?: boolean;
	chevron?: boolean;
	className?: string;
}) {
	return (
		<button
			aria-expanded={open}
			className={cn(TRIGGER_CLASS, open && "bg-surface-hover", className)}
			type="button"
		>
			{icon}
			<span className="truncate">{label}</span>
			{chevron ? (
				<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
			) : null}
		</button>
	);
}

function SearchRow({ placeholder }: { placeholder: string }) {
	return (
		<div className="flex items-center gap-2 border-b border-border px-3 py-2">
			<Search className="size-3 shrink-0 text-muted-foreground" />
			<span className="text-xs text-muted-foreground">{placeholder}</span>
		</div>
	);
}

function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<div className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
			{children}
		</div>
	);
}

/* ------------------------------------------------------------------------ */
/* App frame: fake sidebar + main pane, sized like a small desktop window.   */
/* ------------------------------------------------------------------------ */

function Sidebar({ worktreeSession }: { worktreeSession?: boolean }) {
	const rows: {
		title: string;
		time: string;
		worktree?: boolean;
		active?: boolean;
	}[] = [
		{
			title: "Fix login redirect loop",
			time: "2m",
			worktree: worktreeSession,
			active: worktreeSession,
		},
		{ title: "Upgrade to Tailwind v4", time: "1h", worktree: worktreeSession },
		{ title: "Explain the hub daemon lifecycle", time: "3h" },
		{ title: "Add retry to provider fetch", time: "1d" },
	];
	return (
		<aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-2 py-3 text-sidebar-foreground">
			<button
				className={cn(
					"mb-2 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm",
					worktreeSession
						? "text-sidebar-foreground/80 hover:bg-surface-hover"
						: "bg-surface-hover text-sidebar-foreground",
				)}
				type="button"
			>
				<SquarePen className="size-3.5 shrink-0 text-muted-foreground" />
				New task
				<Kbd className="ml-auto">⌘N</Kbd>
			</button>
			<div className="mt-2 flex h-7 items-center gap-1.5 px-2 text-xs text-muted-foreground">
				<ChevronDown className="size-3" />
				<Folder className="size-3" />
				<span className="truncate">{REPO}</span>
			</div>
			<div className="ml-4 flex flex-col gap-0.5 border-l border-sidebar-border/70 pl-1">
				{rows.map((row) => (
					<button
						className={cn(
							"grid h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md px-2 text-left text-sm",
							row.active
								? "bg-surface-hover text-sidebar-foreground"
								: "text-sidebar-foreground/80 hover:bg-surface-hover",
						)}
						key={row.title}
						type="button"
					>
						<span className="flex min-w-0 items-center gap-1.5">
							{row.worktree ? (
								<FolderGit2
									aria-label="Runs in a worktree"
									className="size-3 shrink-0 text-muted-foreground"
								/>
							) : null}
							<span className="truncate leading-tight">{row.title}</span>
						</span>
						<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
							{row.active ? (
								<span className="size-1.5 rounded-full bg-green-500" />
							) : null}
							{row.time}
						</span>
					</button>
				))}
			</div>
			<div className="mt-3 flex h-7 items-center gap-1.5 px-2 text-xs text-muted-foreground">
				<ChevronDown className="size-3 -rotate-90" />
				<Folder className="size-3" />
				<span className="truncate">cline-hub</span>
			</div>
		</aside>
	);
}

function Frame({
	children,
	worktreeSession,
}: {
	children: ReactNode;
	worktreeSession?: boolean;
}) {
	return (
		<div className="flex h-200 w-280 overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
			<Sidebar worktreeSession={worktreeSession} />
			<main className="relative flex min-w-0 flex-1 flex-col">{children}</main>
		</div>
	);
}

function Composer({
	value,
	placeholder,
	hint,
	footerRight,
	sendButton,
	variant = "welcome",
}: {
	value?: string;
	placeholder?: string;
	hint?: ReactNode;
	footerRight?: ReactNode;
	sendButton?: ReactNode;
	variant?: "welcome" | "conversation";
}) {
	return (
		<div
			className={cn(
				"rounded-xl border bg-card",
				variant === "welcome"
					? "border-border/90 bg-surface-1/40 shadow-[0_24px_80px_-56px_color-mix(in_oklab,var(--primary)_72%,transparent)]"
					: "border-border bg-surface-2",
			)}
		>
			<div className="px-4 pt-4 pb-2">
				<div className="flex min-h-16 items-start gap-2">
					<div className="flex-1 text-sm leading-5">
						{value ? (
							<span className="text-foreground">{value}</span>
						) : (
							<span className="text-muted-foreground">
								{placeholder ??
									"Ask to make changes, @mention files, reference #PRs, or run /commands."}
							</span>
						)}
					</div>
					{sendButton ?? (
						<button
							aria-label="Send message"
							className={cn(
								"p-1.5 text-white",
								value
									? "rounded-md bg-[linear-gradient(145deg,var(--primary-emphasis),var(--primary))] shadow-sm"
									: "rounded-md bg-[linear-gradient(145deg,var(--primary-emphasis),var(--primary))] opacity-50",
							)}
							type="button"
						>
							<ArrowUp className="size-3" />
						</button>
					)}
				</div>
				{hint}
			</div>
			<div className="flex items-center justify-between gap-3 rounded-b-xl border-t border-border bg-muted/20 px-2 py-2 text-sm text-muted-foreground">
				<div className="flex items-center gap-2">
					<span className="rounded-md p-2">
						<Paperclip className="size-3" />
					</span>
					<span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm">
						<Sparkles className="size-3" />
						Claude Sonnet 4.5
					</span>
					<span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm">
						<Brain className="size-3" />
						Medium
					</span>
				</div>
				<div className="flex items-center gap-2">{footerRight}</div>
			</div>
		</div>
	);
}

function WelcomePane({
	controls,
	composer,
}: {
	controls: ReactNode;
	composer: ReactNode;
}) {
	return (
		<div className="mx-auto flex h-full w-full max-w-240 flex-col justify-center px-10 pt-10 pb-80">
			<AgentWelcomeHero interactive={false} />
			<div className="mt-11 flex min-w-0 items-center">{controls}</div>
			<div className="mt-4 w-full">{composer}</div>
		</div>
	);
}

/* ------------------------------------------------------------------------ */
/* Concept A: a dedicated "Run in" chip.                                     */
/* ------------------------------------------------------------------------ */

function RunTargetOption({
	icon,
	title,
	description,
	selected,
	children,
}: {
	icon: ReactNode;
	title: string;
	description: string;
	selected?: boolean;
	children?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"rounded-md border p-2.5",
				selected
					? "border-primary/50 bg-(--accent-4)/60"
					: "border-transparent hover:bg-surface-hover",
			)}
		>
			<div className="flex items-start gap-2.5">
				<span
					className={cn(
						"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
						selected ? "border-primary" : "border-border",
					)}
				>
					{selected ? (
						<span className="size-2 rounded-full bg-primary" />
					) : null}
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
						{icon}
						{title}
					</div>
					<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
						{description}
					</p>
					{children}
				</div>
			</div>
		</div>
	);
}

function ConceptA() {
	return (
		<Frame>
			<WelcomePane
				composer={<Composer />}
				controls={
					<div className="flex min-w-0 items-center gap-2">
						<Chip
							icon={<Folder className="size-3.5 text-muted-foreground" />}
							label={REPO}
						/>
						<Chip
							icon={<GitBranch className="size-3.5 text-muted-foreground" />}
							label={BRANCH}
						/>
						<div className="relative">
							<Chip
								chevron
								icon={<FolderGit2 className="size-3.5 text-muted-foreground" />}
								label="New worktree"
								open
							/>
							<div className={cn(PANEL_CLASS, "w-88 p-1.5")}>
								<SectionLabel>Where should this task run?</SectionLabel>
								<div className="flex flex-col gap-1">
									<RunTargetOption
										description={`Work directly in ${REPO_PATH} on ${BRANCH}. Edits show up in your editor immediately.`}
										icon={<Folder className="size-3 text-muted-foreground" />}
										title="This checkout"
									/>
									<RunTargetOption
										description="An isolated copy under ~/.cline/worktrees. Your checkout and uncommitted work stay untouched."
										icon={
											<FolderGit2 className="size-3 text-muted-foreground" />
										}
										selected
										title="New worktree"
									>
										<div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[11px]">
											<span className="text-muted-foreground">From</span>
											<span className="inline-flex w-fit items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-foreground">
												<GitBranch className="size-2.5 text-muted-foreground" />
												{BRANCH}
												<ChevronDown className="size-2.5 text-muted-foreground" />
											</span>
											<span className="text-muted-foreground">Branch</span>
											<span className="flex items-center rounded border border-border bg-background px-1.5 py-0.5 font-mono text-foreground/60">
												cline/
												<span className="italic">auto-named from prompt</span>
											</span>
										</div>
									</RunTargetOption>
									<RunTargetOption
										description="Continue in a worktree another task already created."
										icon={
											<FolderGit2 className="size-3 text-muted-foreground" />
										}
										title="Existing worktree"
									>
										<div className="mt-1.5 flex flex-col">
											{WORKTREES.map((worktree) => (
												<div
													className="flex items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-surface-hover"
													key={worktree.branch}
												>
													<GitBranch className="size-2.5 shrink-0 text-muted-foreground" />
													<span className="truncate font-medium text-foreground">
														{worktree.branch}
													</span>
													<span className="ml-auto shrink-0 text-muted-foreground">
														{worktree.meta.split(" · ")[0]}
													</span>
												</div>
											))}
										</div>
									</RunTargetOption>
								</div>
								<div className="mt-1.5 flex items-center justify-between border-t border-border px-2 pt-2 pb-0.5 text-[11px] text-muted-foreground">
									<span>Remember for {REPO}</span>
									<Switch checked className="scale-75" />
								</div>
							</div>
						</div>
					</div>
				}
			/>
		</Frame>
	);
}

/* ------------------------------------------------------------------------ */
/* Concept B: the branch chip grows worktree actions.                        */
/* ------------------------------------------------------------------------ */

function ConceptB() {
	return (
		<Frame>
			<WelcomePane
				composer={<Composer />}
				controls={
					<div className="flex min-w-0 items-center gap-2">
						<Chip
							icon={<Folder className="size-3.5 text-muted-foreground" />}
							label={REPO}
						/>
						<div className="relative">
							<Chip
								icon={<GitBranch className="size-3.5 text-muted-foreground" />}
								label={BRANCH}
								open
							/>
							<div className={cn(PANEL_CLASS, "w-80")}>
								<SearchRow placeholder="Search branches and worktrees" />
								<div className="p-1.5">
									<button className={ROW_CLASS} type="button">
										<Plus className="size-3 shrink-0 text-muted-foreground" />
										<span className="font-medium">
											New worktree from {BRANCH}
										</span>
										<Kbd className="ml-auto">⌘⇧N</Kbd>
									</button>

									<SectionLabel>Worktrees</SectionLabel>
									{WORKTREES.map((worktree) => (
										<button
											className={ROW_CLASS}
											key={worktree.branch}
											type="button"
										>
											<FolderGit2 className="size-3 shrink-0 text-muted-foreground" />
											<span className="flex min-w-0 flex-col">
												<span className="truncate font-medium">
													{worktree.branch}
												</span>
												<span className="truncate text-[10px] text-muted-foreground">
													{worktree.path}
												</span>
											</span>
										</button>
									))}

									<SectionLabel>Branches · switch this checkout</SectionLabel>
									{BRANCHES.map((branch, index) => {
										const current = branch === BRANCH;
										const hovered = index === 1;
										return (
											<div
												className={cn(
													"group flex items-center rounded-md",
													current && ACTIVE_ROW_CLASS,
													hovered && "bg-surface-hover",
												)}
												key={branch}
											>
												<button
													className={cn(
														ROW_CLASS,
														"flex-1 hover:bg-transparent",
													)}
													type="button"
												>
													<GitBranch className="size-3 shrink-0 text-muted-foreground" />
													<span className="truncate font-medium">{branch}</span>
													{current ? (
														<Check className="ml-auto size-3 shrink-0" />
													) : null}
												</button>
												{!current ? (
													<button
														aria-label={`Start in a new worktree from ${branch}`}
														className={cn(
															"mr-1 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground",
															hovered
																? "opacity-100"
																: "opacity-0 group-hover:opacity-100",
														)}
														title="Start in a new worktree from this branch"
														type="button"
													>
														<FolderGit2 className="size-3" />
													</button>
												) : null}
											</div>
										);
									})}
									<div className="mt-1 px-2 pt-1.5 text-[10px] leading-snug text-muted-foreground">
										Hover a branch to start the task in a fresh worktree based
										on it, without leaving {BRANCH}.
									</div>
								</div>
							</div>
						</div>
					</div>
				}
			/>
		</Frame>
	);
}

/* ------------------------------------------------------------------------ */
/* Concept C: split send button + prompt-derived branch name.                */
/* ------------------------------------------------------------------------ */

function ConceptC() {
	const prompt =
		"Fix the login redirect loop when the session cookie expires mid-request";
	return (
		<Frame>
			<WelcomePane
				composer={
					<Composer
						hint={
							<div className="mt-2 flex max-w-[60%] flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
								<FolderGit2 className="size-3" />
								Will start in a new worktree as
								<span className="font-mono text-foreground/80">
									cline/fix-login-redirect-loop
								</span>
								<span>· from {BRANCH}</span>
								<button
									className="ml-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
									type="button"
								>
									edit
								</button>
							</div>
						}
						sendButton={
							<div className="relative flex items-stretch">
								<button
									aria-label="Start in new worktree"
									className="rounded-l-md bg-[linear-gradient(145deg,var(--primary-emphasis),var(--primary))] p-1.5 text-white shadow-sm"
									type="button"
								>
									<ArrowUp className="size-3" />
								</button>
								<button
									aria-label="More ways to start"
									className="rounded-r-md border-l border-white/20 bg-[linear-gradient(145deg,var(--primary-emphasis),var(--primary))] px-1 text-white shadow-sm"
									type="button"
								>
									<ChevronDown className="size-3" />
								</button>
								<div className="absolute top-full right-0 z-50 mt-2 w-72 rounded-lg border border-border bg-popover p-1.5 shadow-xl">
									<button className={ROW_CLASS} type="button">
										<Folder className="size-3 shrink-0 text-muted-foreground" />
										<span className="flex flex-col">
											<span className="font-medium">Start here</span>
											<span className="text-[10px] text-muted-foreground">
												{REPO_PATH} · {BRANCH}
											</span>
										</span>
										<Kbd className="ml-auto">↩</Kbd>
									</button>
									<button
										className={cn(ROW_CLASS, ACTIVE_ROW_CLASS)}
										type="button"
									>
										<FolderGit2 className="size-3 shrink-0 text-muted-foreground" />
										<span className="flex flex-col">
											<span className="font-medium">
												Start in a new worktree
											</span>
											<span className="text-[10px] text-muted-foreground">
												Isolated branch off {BRANCH}
											</span>
										</span>
										<Kbd className="ml-auto">⌘⇧↩</Kbd>
									</button>
									<button className={ROW_CLASS} type="button">
										<GitBranch className="size-3 shrink-0 text-muted-foreground" />
										<span className="flex flex-col">
											<span className="font-medium">
												Start in an existing worktree
											</span>
											<span className="text-[10px] text-muted-foreground">
												{WORKTREES.length} available
											</span>
										</span>
										<ChevronDown className="ml-auto size-3 -rotate-90 text-muted-foreground" />
									</button>
									<div className="mt-1 flex items-center justify-between border-t border-border px-2 pt-2 pb-0.5 text-[10px] text-muted-foreground">
										<span>Default for {REPO}: new worktree</span>
										<button
											className="underline decoration-dotted underline-offset-2 hover:text-foreground"
											type="button"
										>
											Change
										</button>
									</div>
								</div>
							</div>
						}
						value={prompt}
					/>
				}
				controls={
					<div className="flex min-w-0 items-center gap-2">
						<Chip
							icon={<Folder className="size-3.5 text-muted-foreground" />}
							label={REPO}
						/>
						<Chip
							icon={<GitBranch className="size-3.5 text-muted-foreground" />}
							label={BRANCH}
						/>
					</div>
				}
			/>
		</Frame>
	);
}

/* ------------------------------------------------------------------------ */
/* Concept D: a task that lives in a worktree.                               */
/* ------------------------------------------------------------------------ */

function Bubble({
	author,
	children,
}: {
	author: "user" | "assistant";
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				"max-w-[78%] rounded-xl px-4 py-2.5 text-sm leading-6",
				author === "user"
					? "self-end bg-surface-2 text-foreground"
					: "self-start text-foreground",
			)}
		>
			{children}
		</div>
	);
}

function ConceptD() {
	const worktree = WORKTREES[0];
	return (
		<Frame worktreeSession>
			<header className="flex h-12 items-center gap-2 border-b border-border px-5 text-sm">
				<span className="font-medium text-foreground">
					Fix login redirect loop
				</span>
				<span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground">
					<FolderGit2 className="size-3" />
					worktree
				</span>
			</header>
			<div className="flex flex-1 flex-col gap-4 overflow-hidden px-6 py-6">
				<Bubble author="user">
					Fix the login redirect loop when the session cookie expires
					mid-request.
				</Bubble>
				<Bubble author="assistant">
					The loop comes from{" "}
					<code className="font-mono text-xs">auth/middleware.ts</code>{" "}
					re-issuing a redirect to{" "}
					<code className="font-mono text-xs">/login</code> even when the
					request is already for{" "}
					<code className="font-mono text-xs">/login</code>. I added an early
					return for auth routes and a regression test.
					<div className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
						<span>✓ Edited auth/middleware.ts</span>
						<span>✓ Edited auth/middleware.test.ts</span>
						<span>✓ bun test auth — 14 passed</span>
					</div>
				</Bubble>
			</div>
			<div className="px-6 pb-6">
				<Composer
					footerRight={
						<div className="relative">
							<button
								className="inline-flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1 text-sm text-foreground"
								type="button"
							>
								<FolderGit2 className="size-3 text-muted-foreground" />
								<span className="max-w-44 truncate">{worktree.branch}</span>
							</button>
							<div className="absolute right-0 bottom-full z-50 mb-2 w-80 rounded-lg border border-border bg-popover shadow-xl">
								<div className="border-b border-border px-3 py-2.5">
									<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
										<FolderGit2 className="size-3 text-muted-foreground" />
										{worktree.branch}
									</div>
									<div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
										{worktree.path}
									</div>
									<div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
										<span className="inline-flex items-center gap-1">
											<GitBranch className="size-3" />
											from {BRANCH} · 3 commits ahead
										</span>
										<span>
											<span className="text-green-500">+42</span>{" "}
											<span className="text-red-400">−7</span> · 3 files
										</span>
									</div>
								</div>
								<div className="p-1.5">
									<button className={ROW_CLASS} type="button">
										<ExternalLink className="size-3 text-muted-foreground" />
										Open in editor
									</button>
									<button className={ROW_CLASS} type="button">
										<Terminal className="size-3 text-muted-foreground" />
										Open in terminal
									</button>
									<button className={ROW_CLASS} type="button">
										<Copy className="size-3 text-muted-foreground" />
										Copy path
									</button>
								</div>
								<div className="border-t border-border p-1.5">
									<button className={ROW_CLASS} type="button">
										<GitMerge className="size-3 text-muted-foreground" />
										<span className="flex flex-col">
											<span>Merge into {BRANCH}…</span>
											<span className="text-[10px] text-muted-foreground">
												Squash, rebase, or merge commit
											</span>
										</span>
									</button>
									<button className={ROW_CLASS} type="button">
										<GitPullRequest className="size-3 text-muted-foreground" />
										Create pull request
									</button>
								</div>
								<div className="border-t border-border p-1.5">
									<button
										className={cn(
											ROW_CLASS,
											"text-destructive hover:text-destructive",
										)}
										type="button"
									>
										<Trash2 className="size-3" />
										<span className="flex flex-col">
											<span>Remove worktree</span>
											<span className="text-[10px] text-muted-foreground">
												Keeps the branch. Session history is kept.
											</span>
										</span>
									</button>
								</div>
							</div>
						</div>
					}
					placeholder="Enter your question or type / for commands or @ for context"
					variant="conversation"
				/>
			</div>
		</Frame>
	);
}

/* ------------------------------------------------------------------------ */

export default function WorktreeMockupsPage() {
	const [concept, setConcept] = useState<ConceptId>("a");
	const [chrome, setChrome] = useState(true);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const requested = params.get("concept");
		if (
			requested === "a" ||
			requested === "b" ||
			requested === "c" ||
			requested === "d"
		) {
			setConcept(requested);
		}
		if (params.get("chrome") === "0") setChrome(false);
		const theme = params.get("theme");
		if (theme === "dark" || theme === "light") applyHubTheme(theme);
	}, []);

	const select = (id: ConceptId) => {
		setConcept(id);
		const url = new URL(window.location.href);
		url.searchParams.set("concept", id);
		window.history.replaceState(null, "", url);
	};

	const active = CONCEPTS.find((entry) => entry.id === concept) ?? CONCEPTS[0];

	return (
		<div className="flex h-full min-h-screen flex-col items-center gap-6 overflow-auto bg-surface-2 px-8 py-8 text-foreground">
			{chrome ? (
				<div className="flex w-280 flex-col gap-3">
					<div className="flex flex-wrap items-center gap-2">
						{CONCEPTS.map((entry) => (
							<button
								className={cn(
									"rounded-md border px-3 py-1.5 text-sm",
									entry.id === concept
										? "border-primary/50 bg-(--accent-4) text-foreground"
										: "border-border bg-background text-muted-foreground hover:text-foreground",
								)}
								key={entry.id}
								onClick={() => select(entry.id)}
								type="button"
							>
								{entry.title}
							</button>
						))}
					</div>
					<p className="text-sm text-muted-foreground">{active.summary}</p>
				</div>
			) : null}
			{concept === "a" ? <ConceptA /> : null}
			{concept === "b" ? <ConceptB /> : null}
			{concept === "c" ? <ConceptC /> : null}
			{concept === "d" ? <ConceptD /> : null}
		</div>
	);
}
