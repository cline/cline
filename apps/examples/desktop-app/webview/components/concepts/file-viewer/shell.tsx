"use client";

import {
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	Blocks,
	Brain,
	ChevronDown,
	Clock3,
	FolderTree,
	Funnel,
	GitBranch,
	MoreHorizontal,
	Paperclip,
	Plus,
	Search,
	Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PROJECT, SESSION_TITLE } from "./mock-data";

export function ClineMark({ className }: { className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn("inline-block shrink-0 bg-current", className)}
			style={{
				maskImage: "url('/icon.svg')",
				maskPosition: "center",
				maskRepeat: "no-repeat",
				maskSize: "contain",
				WebkitMaskImage: "url('/icon.svg')",
				WebkitMaskPosition: "center",
				WebkitMaskRepeat: "no-repeat",
				WebkitMaskSize: "contain",
			}}
		/>
	);
}

const SESSIONS = [
	{ title: SESSION_TITLE, time: "now", active: true },
	{ title: "Fix flaky auth redirect test", time: "2h" },
	{ title: "Migrate billing cron to the job queue", time: "1d" },
	{ title: "Investigate slow dashboard load", time: "2d" },
	{ title: "Refactor sidebar nav for mobile", time: "4d" },
	{ title: "Write onboarding docs for the API", time: "1w" },
];

const navButton =
	"inline-flex h-9 w-full items-center justify-start gap-2 rounded-md px-2 text-left text-sm font-medium text-muted-foreground hover:bg-surface-hover hover:text-sidebar-foreground";

export function SidebarNavHeader() {
	return (
		<>
			<div className="flex h-12 shrink-0 items-center justify-end gap-0.5 pr-2 pl-19">
				<span className="inline-flex size-8 items-center justify-center text-muted-foreground">
					<ArrowLeft className="size-4.5" />
				</span>
				<span className="inline-flex size-8 items-center justify-center text-muted-foreground opacity-50">
					<ArrowRight className="size-4.5" />
				</span>
			</div>
			<div className="flex h-10 shrink-0 items-center justify-between px-2">
				<span className="flex size-8 items-center justify-center rounded-md text-sidebar-foreground">
					<ClineMark className="size-5" />
				</span>
				<span className="inline-flex size-8 items-center justify-center text-muted-foreground">
					<Search className="size-4" />
				</span>
			</div>
		</>
	);
}

export function SidebarFooter() {
	return (
		<div className="shrink-0 border-t border-sidebar-border/70 px-2 py-3">
			<span className={navButton}>
				<Settings className="size-4" />
				Settings
			</span>
		</div>
	);
}

export function AppSidebar({ children }: { children?: ReactNode }) {
	return (
		<aside className="flex h-full w-[260px] shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
			<SidebarNavHeader />
			{children ?? (
				<>
					<nav className="mt-1 flex shrink-0 flex-col gap-0.5 px-2">
						<span className={navButton}>
							<Plus className="size-4 shrink-0" />
							Session
						</span>
						<span className={navButton}>
							<Clock3 className="size-4 shrink-0" />
							Schedule
						</span>
						<span className={navButton}>
							<Blocks className="size-4 shrink-0" />
							Customize
						</span>
					</nav>
					<SessionList />
				</>
			)}
			<SidebarFooter />
		</aside>
	);
}

export function SessionList() {
	return (
		<>
			<div className="mt-5 shrink-0 pr-2 pl-4">
				<div className="flex h-8 items-center justify-between gap-2">
					<span className="text-sm font-medium text-muted-foreground">
						Sessions
					</span>
					<div className="flex items-center gap-0.5 text-muted-foreground">
						<span className="inline-flex size-8 items-center justify-center">
							<FolderTree className="size-3.5" />
						</span>
						<span className="inline-flex size-8 items-center justify-center">
							<Funnel className="size-3" />
						</span>
					</div>
				</div>
			</div>
			<div className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5 px-2">
				{SESSIONS.map((session) => (
					<div
						className={cn(
							"grid h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-cline-ui-md px-2 text-sm",
							session.active && "bg-cline-ui-surface-hover",
						)}
						key={session.title}
					>
						<span className="truncate leading-tight">{session.title}</span>
						<span className="text-xs text-muted-foreground">
							{session.time}
						</span>
					</div>
				))}
			</div>
		</>
	);
}

export function SessionHeader({
	actions,
	title = SESSION_TITLE,
	center,
	diff = true,
	leading,
}: {
	actions?: ReactNode;
	title?: string;
	center?: ReactNode;
	diff?: boolean;
	leading?: ReactNode;
}) {
	return (
		<div className="z-20 shrink-0 border-b border-border/70 bg-background/85 backdrop-blur-sm">
			<header className="flex h-12 items-center justify-between gap-2 px-4">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					{leading}
					<span className="size-1.5 shrink-0 rounded-full bg-chart-2" />
					<span className="min-w-0 truncate px-1 text-sm font-medium text-foreground">
						{title}
					</span>
					<MoreHorizontal className="size-3 shrink-0 text-muted-foreground" />
				</div>
				{center}
				<div className="flex shrink-0 items-center gap-2">
					{actions}
					{diff ? <DiffStatsButton /> : null}
					<span className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground">
						<Plus className="size-4" />
					</span>
				</div>
			</header>
		</div>
	);
}

export function DiffStatsButton() {
	return (
		<span className="flex h-7 items-center gap-1 rounded-md bg-secondary px-2 font-mono text-xs">
			<span className="text-chart-2">+99</span>
			<span className="text-destructive">-6</span>
		</span>
	);
}

export function HeaderIconButton({
	children,
	active,
	label,
}: {
	children: ReactNode;
	active?: boolean;
	label?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-7 items-center gap-1.5 rounded-md text-muted-foreground",
				label ? "px-2 text-xs font-medium" : "w-7 justify-center",
				active && "bg-secondary text-foreground",
			)}
		>
			{children}
			{label}
		</span>
	);
}

export function InlineCode({
	children,
	link,
	active,
}: {
	children: ReactNode;
	link?: boolean;
	active?: boolean;
}) {
	return (
		<code
			className={cn(
				"rounded bg-muted px-1.5 py-0.5 font-mono text-sm",
				link &&
					"cursor-pointer underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-foreground",
				active && "bg-primary/12 text-primary ring-1 ring-primary/30",
			)}
		>
			{children}
		</code>
	);
}

export function ChatConversation({
	linkFiles,
	activeLink,
	work,
	compact,
}: {
	linkFiles?: boolean;
	activeLink?: string;
	work?: ReactNode;
	compact?: boolean;
}) {
	const file = (path: string, label = path) => (
		<InlineCode active={activeLink === path} link={linkFiles}>
			{label}
		</InlineCode>
	);
	return (
		<div className="min-h-0 flex-1 overflow-hidden">
			<div className={cn("w-full min-w-0", compact ? "px-5" : "px-6")}>
				<div className="relative mx-auto w-full min-w-0 max-w-(--breakpoint-lg) pt-6 pb-16">
					<div className="flex w-full min-w-0 flex-col gap-4">
						<div
							className="cline-chat-message relative flex flex-col gap-2"
							data-role="user"
						>
							<div className="cline-chat-message-content flex min-w-0 flex-col gap-2">
								<div className="cline-markdown space-y-4">
									<p>
										Add a CSV export button to the invoices table. Reuse our
										Button component and add tests for the CSV helper.
									</p>
								</div>
							</div>
						</div>
						{work ?? (
							<div className="cline-chat-work">
								<button className="cline-chat-work-trigger" type="button">
									<span className="cline-chat-tool-label">
										Worked for 1m 12s and made 11 tool calls
									</span>
									<ChevronDown className="cline-chat-disclosure-icon" />
								</button>
							</div>
						)}
						<div
							className="cline-chat-message relative -mt-2 flex flex-col gap-2"
							data-role="assistant"
						>
							<div className="cline-chat-message-content flex min-w-0 flex-col gap-2">
								<div className="cline-markdown space-y-4">
									<p>
										Added CSV export to the invoices table. The new{" "}
										{file("src/lib/csv.ts", "toCsv")} helper serializes rows per
										RFC 4180, and {file("src/components/export-button.tsx")}{" "}
										wraps our existing Button.
									</p>
									<ul className="list-disc space-y-1.5 pl-5">
										<li>
											{file("src/components/invoice-table.tsx")} builds the file
											client-side and names it by date
										</li>
										<li>
											{file("src/app/api/invoices/route.ts")} now accepts{" "}
											<InlineCode>?format=csv</InlineCode> for large exports
										</li>
										<li>
											{file("tests/csv.test.ts")} covers quoting, commas, and
											empty values (6 passing)
										</li>
									</ul>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export function Composer({
	chips,
	toolbarStart,
	placeholder = "Enter your question or type / for commands or @ for context",
	text,
	compact,
	above,
}: {
	chips?: ReactNode;
	toolbarStart?: ReactNode;
	placeholder?: string;
	text?: string;
	compact?: boolean;
	above?: ReactNode;
}) {
	return (
		<div
			className={cn("relative z-20 shrink-0 pb-6", compact ? "px-5" : "px-6")}
		>
			<div className="relative mx-auto w-full min-w-0 max-w-(--breakpoint-lg)">
				{above}
				<div className="overflow-visible rounded-cline-ui-xl border border-cline-ui-border bg-cline-ui-surface-2 backdrop-blur-sm">
					<div className="px-4 py-4">
						{chips ? (
							<div className="mb-2.5 flex flex-wrap gap-1.5">{chips}</div>
						) : null}
						<div className="flex min-h-16 items-start gap-2">
							<div
								className={cn(
									"flex-1 text-cline-ui-sm leading-5",
									text ? "text-foreground" : "text-cline-ui-muted-foreground",
								)}
							>
								{text ?? placeholder}
							</div>
							<span className="self-end rounded-full bg-cline-ui-primary p-1.5 text-cline-ui-background opacity-50">
								<ArrowUp className="size-3" />
							</span>
						</div>
					</div>
					<div className="flex min-w-0 items-center justify-between gap-3 rounded-b-cline-ui-xl border-t border-cline-ui-border bg-cline-ui-muted/20 px-2 py-2 text-cline-ui-sm text-cline-ui-muted-foreground">
						<div className="flex min-w-0 flex-auto items-center gap-1">
							<span className="rounded-md p-2 text-muted-foreground">
								<Paperclip className="size-3" />
							</span>
							{toolbarStart}
							{compact ? null : (
								<>
									<span className="inline-flex items-center gap-1 px-2 py-1 text-sm font-medium text-foreground">
										Cline
										<ChevronDown className="size-2.5 text-muted-foreground" />
									</span>
									<span className="h-4 w-[0.1rem] bg-border-2" />
								</>
							)}
							<span className="inline-flex shrink-0 items-center gap-1 px-2 py-1 text-sm font-medium text-foreground">
								Claude Sonnet 5
								<ChevronDown className="size-2.5 text-muted-foreground" />
							</span>
							<span className="inline-flex items-center gap-1.5 px-2 text-sm">
								<Brain className="size-3" />
								{compact ? null : "Medium"}
							</span>
						</div>
						<div className="ml-auto flex min-w-0 items-center gap-1 text-sm">
							<GitBranch className="size-3" />
							{compact ? null : (
								<>
									<span className="max-w-28 truncate">{PROJECT.name}</span>
									<span className="text-muted-foreground/60">/</span>
									<span className="max-w-36 truncate">{PROJECT.branch}</span>
								</>
							)}
							<span className="ml-1 inline-flex size-7 items-center justify-center opacity-65">
								<svg
									aria-hidden="true"
									className="size-3.5 -rotate-90"
									viewBox="0 0 22 22"
								>
									<circle
										cx="11"
										cy="11"
										fill="none"
										r="9"
										stroke="currentColor"
										strokeOpacity="0.25"
										strokeWidth="3"
									/>
									<circle
										cx="11"
										cy="11"
										fill="none"
										r="9"
										stroke="currentColor"
										strokeDasharray="56.5"
										strokeDashoffset="45"
										strokeWidth="3"
									/>
								</svg>
							</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export function ContextChip({
	children,
	icon,
}: {
	children: ReactNode;
	icon?: ReactNode;
}) {
	return (
		<span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-background px-2 font-mono text-[11px] text-foreground">
			{icon}
			{children}
			<span className="ml-0.5 text-muted-foreground">×</span>
		</span>
	);
}

export function AppFrame({
	sidebar,
	children,
}: {
	sidebar?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
			{sidebar === null ? null : (sidebar ?? <AppSidebar />)}
			<main className="relative flex min-w-0 flex-1 flex-col bg-background">
				{children}
			</main>
		</div>
	);
}
