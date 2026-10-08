"use client";

/**
 * Static UI concepts for an integrated terminal, rendered inside the real app
 * shell for design review. Enabled with `?terminalConcept=1..5`; renders
 * nothing otherwise. Not wired to a real PTY.
 */

import {
	AgentComposer,
	AgentComposerActions,
	AgentComposerBody,
	AgentComposerField,
	AgentComposerSettings,
	AgentComposerSettingsEnd,
	AgentComposerSettingsGroup,
} from "@cline/ui";
import {
	ArrowRight,
	Check,
	ChevronDown,
	ChevronRight,
	Columns2,
	Copy,
	CornerDownLeft,
	ExternalLink,
	Eye,
	FolderGit2,
	House,
	Maximize2,
	MessageSquare,
	Plus,
	Sparkles,
	Square,
	SquareTerminal,
	X,
} from "lucide-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Kbd } from "@/components/ui/kbd";
import { WindowTitleBarContent } from "@/components/window-title-bar";
import { cn } from "@/lib/utils";

export type TerminalConcept = 1 | 2 | 3 | 4 | 5;

type TerminalConceptState = {
	concept: TerminalConcept;
	scope: "home" | "session";
	cwd: string;
};

const TerminalConceptContext = createContext<TerminalConceptState | null>(null);

export function useTerminalConcept(): TerminalConceptState | null {
	return useContext(TerminalConceptContext);
}

function readConceptParam(): TerminalConcept | null {
	const value = Number(
		new URLSearchParams(window.location.search).get("terminalConcept"),
	);
	return value >= 1 && value <= 5 ? (value as TerminalConcept) : null;
}

function tildify(path: string): string {
	return path.replace(/^\/(?:home|Users)\/[^/]+/, "~") || "~";
}

// ---------------------------------------------------------------------------
// Mock terminal rendering
// ---------------------------------------------------------------------------

type Segment = [text: string, className?: string];
type Line = Segment[];

const C = {
	cwd: "text-sky-400",
	branch: "text-violet-400",
	ok: "text-emerald-400",
	warn: "text-amber-300",
	err: "text-red-400",
	dim: "text-muted-foreground",
	bold: "text-foreground font-semibold",
};

function repoName(cwd: string): string {
	return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

function prompt(cwd: string, command = "", branch?: string): Line {
	return [
		[cwd, C.cwd],
		...(branch ? ([[` ${branch}`, C.branch]] as Line) : []),
		[" ❯ ", C.ok],
		[command],
	];
}

const t = (text: string, className?: string): Line => [[text, className]];

function homeLines(): Line[] {
	return [
		t("Last login: Thu Oct  8 20:02:11 on ttys004", C.dim),
		prompt("~", "ls"),
		t("Code        Desktop     Documents   Downloads   Pictures"),
		prompt("~", "brew outdated"),
		[["gh "], ["(2.62.0) < 2.81.0", C.dim]],
		[["node "], ["(22.14.0) < 22.20.0", C.dim]],
		prompt("~", "brew upgrade gh"),
		[
			["==> ", C.ok],
			["Upgrading 1 outdated package:", C.bold],
		],
		t("gh 2.62.0 -> 2.81.0"),
		[
			["==> ", C.ok],
			["Pouring gh--2.81.0.arm64_sequoia.bottle.tar.gz", C.bold],
		],
		[["🍺  /opt/homebrew/Cellar/gh/2.81.0: 214 files, 52.3MB", ""]],
		prompt("~"),
	];
}

function testLines(cwd: string): Line[] {
	return [
		prompt(cwd, "bun test", "main"),
		t("bun test v1.3.13 (bf2e2cec)", C.dim),
		t(""),
		t("src/users.test.ts:"),
		[
			["✓", C.ok],
			[" users > listUsers returns the seeded users "],
			["[0.21ms]", C.dim],
		],
		[
			["✓", C.ok],
			[" users > getUser finds a user by id "],
			["[0.05ms]", C.dim],
		],
		[
			["✓", C.ok],
			[" users > getUser returns undefined for unknown ids "],
			["[0.02ms]", C.dim],
		],
		[["✓", C.ok], [" users > createUser adds a user "], ["[0.04ms]", C.dim]],
		t(""),
		t(" 4 pass", C.ok),
		t(" 0 fail", C.dim),
		t(" 7 expect() calls"),
		[["Ran 4 tests across 1 file. "], ["[18.00ms]", C.dim]],
		prompt(cwd, "git status -s", "main"),
		[[" M ", C.warn], ["src/server.ts"]],
		[[" M ", C.warn], ["src/users.ts"]],
		[["?? ", C.err], ["src/users.test.ts"]],
		prompt(cwd, "", "main"),
	];
}

function devServerLines(): Line[] {
	return [
		[["$ ", C.dim], ["bun run --hot src/server.ts"]],
		[
			["listening on ", C.dim],
			["http://localhost:3000", "text-sky-400 underline underline-offset-2"],
		],
		t(""),
		[
			["20:21:04 ", C.dim],
			["GET  /users        "],
			["200", C.ok],
			["  1.2ms", C.dim],
		],
		[
			["20:21:09 ", C.dim],
			["POST /users        "],
			["201", C.ok],
			["  3.8ms", C.dim],
		],
		[
			["20:21:12 ", C.dim],
			["POST /users        "],
			["400", C.warn],
			["  0.6ms", C.dim],
			["  email must be a string", C.dim],
		],
		[
			["20:21:15 ", C.dim],
			["GET  /users/alan   "],
			["200", C.ok],
			["  0.9ms", C.dim],
		],
		[
			["20:22:41 ", C.dim],
			["[hot] ", "text-violet-400"],
			["reloaded src/server.ts", C.dim],
		],
		[
			["20:22:43 ", C.dim],
			["GET  /users        "],
			["200", C.ok],
			["  1.0ms", C.dim],
		],
		[
			["20:23:10 ", C.dim],
			["POST /users        "],
			["201", C.ok],
			["  2.9ms", C.dim],
		],
		[
			["20:23:12 ", C.dim],
			["GET  /users/grace  "],
			["200", C.ok],
			["  0.7ms", C.dim],
		],
		[
			["20:23:19 ", C.dim],
			["GET  /users/bob    "],
			["404", C.warn],
			["  0.4ms", C.dim],
		],
	];
}

function curlLines(cwd: string): Line[] {
	return [
		prompt(cwd, "curl -s localhost:3000/users/alan | jq", "main"),
		t("{"),
		[['  "id"', C.cwd], [": "], ['"alan"', C.ok], [","]],
		[['  "name"', C.cwd], [": "], ['"Alan Turing"', C.ok], [","]],
		[['  "email"', C.cwd], [": "], ['"alan@acme.dev"', C.ok]],
		t("}"),
		prompt(cwd, "", "main"),
	];
}

function cloneLines(): Line[] {
	return [
		prompt("~", "gh repo clone acme/acme-web ~/code/acme-web"),
		t("Cloning into '/Users/saoud/code/acme-web'..."),
		t("remote: Enumerating objects: 1284, done."),
		t("remote: Counting objects: 100% (412/412), done."),
		t("Receiving objects: 100% (1284/1284), 2.31 MiB | 9.80 MiB/s, done."),
		t("Resolving deltas: 100% (702/702), done."),
		prompt("~", "cd ~/code/acme-web && bun install"),
		[
			["bun install ", C.bold],
			["v1.3.13 (bf2e2cec)", C.dim],
		],
		t(""),
		[["+ ", C.ok], ["@types/bun"], ["@1.3.13", C.dim]],
		[["+ ", C.ok], ["typescript"], ["@5.9.3", C.dim]],
		t(""),
		[["14 packages", C.ok], [" installed "], ["[412.00ms]", C.dim]],
		prompt("~/code/acme-web", "", "main"),
	];
}

function Cursor() {
	return (
		<span className="ml-px inline-block h-[1.15em] w-[0.6em] translate-y-[0.2em] bg-foreground/85" />
	);
}

function TerminalScreen({
	lines,
	cursor = true,
	className,
}: {
	lines: Line[];
	cursor?: boolean;
	className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
	});
	return (
		<div
			ref={ref}
			className={cn(
				"cline-chat-selectable min-h-0 overflow-hidden px-4 py-3 font-mono text-[12.5px] leading-[1.6] text-foreground/90",
				className,
			)}
		>
			{lines.map((line, index) => (
				<div
					className="min-h-[1.6em] whitespace-pre"
					// biome-ignore lint/suspicious/noArrayIndexKey: static mock content
					key={index}
				>
					{line.map(([text, segClass], segIndex) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static mock content
						<span className={segClass} key={segIndex}>
							{text}
						</span>
					))}
					{cursor && index === lines.length - 1 ? <Cursor /> : null}
				</div>
			))}
		</div>
	);
}

function IconButton({
	children,
	label,
	active,
	className,
}: {
	children: ReactNode;
	label: string;
	active?: boolean;
	className?: string;
}) {
	return (
		<button
			aria-label={label}
			className={cn(
				"flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground [&_svg]:size-3.5",
				active && "bg-secondary text-foreground",
				className,
			)}
			type="button"
		>
			{children}
		</button>
	);
}

function StatusDot({ tone }: { tone: "running" | "idle" | "error" }) {
	return (
		<span
			className={cn(
				"inline-block size-1.5 shrink-0 rounded-full",
				tone === "running" &&
					"bg-emerald-400 shadow-[0_0_0_3px] shadow-emerald-400/15",
				tone === "idle" && "bg-muted-foreground/50",
				tone === "error" && "bg-red-400",
			)}
		/>
	);
}

// ---------------------------------------------------------------------------
// Header / title bar toggles
// ---------------------------------------------------------------------------

/** Rendered in the session header's action row. */
export function TerminalConceptHeaderAction() {
	const state = useTerminalConcept();
	if (!state) return null;
	if (state.concept === 5) {
		return (
			<div className="flex items-center rounded-md bg-secondary/60 p-0.5 text-xs">
				<span className="flex items-center gap-1.5 rounded px-2 py-1 text-muted-foreground">
					<MessageSquare className="size-3" />
					Chat
				</span>
				<span className="flex items-center gap-1.5 rounded bg-background px-2 py-1 text-foreground shadow-sm">
					<SquareTerminal className="size-3" />
					Terminal
					<StatusDot tone="running" />
				</span>
			</div>
		);
	}
	if (state.concept === 4) return null;
	return (
		<IconButton active={state.concept !== 3} label="Toggle terminal">
			<SquareTerminal />
		</IconButton>
	);
}

/** Home has no session header, so the toggle projects into the title bar. */
function HomeTitleBarToggle({ active }: { active: boolean }) {
	return (
		<WindowTitleBarContent>
			<div className="flex h-full items-center justify-end px-3">
				<IconButton active={active} label="Toggle terminal">
					<SquareTerminal />
				</IconButton>
			</div>
		</WindowTitleBarContent>
	);
}

// ---------------------------------------------------------------------------
// Concept 1: bottom panel
// ---------------------------------------------------------------------------

function PanelTab({
	children,
	active,
	tone,
}: {
	children: ReactNode;
	active?: boolean;
	tone?: "running" | "idle";
}) {
	return (
		<div
			className={cn(
				"group flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs",
				active
					? "bg-background text-foreground shadow-[inset_0_0_0_1px] shadow-border/70"
					: "text-muted-foreground hover:bg-surface-hover",
			)}
		>
			{tone ? (
				<StatusDot tone={tone} />
			) : (
				<SquareTerminal className="size-3.5" />
			)}
			{children}
			{active ? <X className="ml-0.5 size-3 text-muted-foreground" /> : null}
		</div>
	);
}

function BottomPanel({ state }: { state: TerminalConceptState }) {
	const session = state.scope === "session";
	return (
		<section
			aria-label="Terminal"
			className="relative flex h-[330px] shrink-0 flex-col border-t border-border bg-sidebar"
		>
			<div className="absolute inset-x-0 -top-1 flex h-2 cursor-row-resize justify-center">
				<span className="mt-[3px] h-[3px] w-10 rounded-full bg-border" />
			</div>
			<header className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
				<PanelTab active>
					<span>zsh</span>
					<span className="text-muted-foreground">{repoName(state.cwd)}</span>
				</PanelTab>
				{session ? (
					<PanelTab tone="running">
						<span>bun run dev</span>
					</PanelTab>
				) : null}
				<IconButton label="New terminal">
					<Plus />
				</IconButton>
				<div className="ml-auto flex items-center gap-1">
					<span className="mr-2 flex items-center gap-1.5 rounded-md border border-border/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
						{session ? (
							<FolderGit2 className="size-3" />
						) : (
							<House className="size-3" />
						)}
						{state.cwd}
					</span>
					<IconButton label="Split terminal">
						<Columns2 />
					</IconButton>
					<IconButton label="Maximize panel">
						<Maximize2 />
					</IconButton>
					<IconButton label="Hide panel">
						<ChevronDown />
					</IconButton>
				</div>
			</header>
			<TerminalScreen
				className="flex-1"
				lines={session ? testLines(state.cwd) : homeLines()}
			/>
		</section>
	);
}

// ---------------------------------------------------------------------------
// Concept 2: right dock with stacked panes
// ---------------------------------------------------------------------------

function RightDock({ state }: { state: TerminalConceptState }) {
	const session = state.scope === "session";
	return (
		<aside
			aria-label="Terminal"
			className="flex w-[min(46%,600px)] shrink-0 flex-col border-l border-border bg-sidebar"
		>
			<header className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-2">
				<div className="flex items-center rounded-md bg-background/60 p-0.5 text-xs">
					<span className="flex items-center gap-1.5 rounded bg-secondary px-2.5 py-1 text-foreground">
						<SquareTerminal className="size-3.5" />
						Terminal
					</span>
					{session ? (
						<span className="flex items-center gap-1.5 rounded px-2.5 py-1 text-muted-foreground">
							Changes
							<span className="font-mono text-[11px]">
								<span className="text-chart-2">+50</span>{" "}
								<span className="text-destructive">-5</span>
							</span>
						</span>
					) : null}
				</div>
				<div className="ml-auto flex items-center gap-1">
					<IconButton label="New terminal">
						<Plus />
					</IconButton>
					<IconButton label="Close panel">
						<X />
					</IconButton>
				</div>
			</header>
			{session ? (
				<div className="flex min-h-0 flex-[0_0_46%] flex-col border-b border-border/60">
					<div className="flex h-9 shrink-0 items-center gap-2 px-3 text-xs">
						<StatusDot tone="running" />
						<span className="font-mono text-foreground">bun run dev</span>
						<span className="text-muted-foreground">· :3000 · 12m</span>
						<div className="ml-auto flex items-center gap-0.5">
							<IconButton label="Open in browser">
								<ExternalLink />
							</IconButton>
							<IconButton label="Stop process">
								<Square />
							</IconButton>
						</div>
					</div>
					<TerminalScreen
						className="flex-1 pt-0"
						cursor={false}
						lines={devServerLines()}
					/>
				</div>
			) : null}
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex h-9 shrink-0 items-center gap-2 px-3 text-xs">
					<SquareTerminal className="size-3.5 text-muted-foreground" />
					<span className="text-foreground">zsh</span>
					<span className="font-mono text-muted-foreground">{state.cwd}</span>
				</div>
				<TerminalScreen
					className="flex-1 pt-0"
					lines={session ? curlLines(state.cwd) : homeLines()}
				/>
			</div>
		</aside>
	);
}

// ---------------------------------------------------------------------------
// Concept 3: quick terminal drop-down
// ---------------------------------------------------------------------------

function QuickTerminal({ state }: { state: TerminalConceptState }) {
	const session = state.scope === "session";
	return (
		<div className="absolute inset-0 z-40 flex justify-center bg-background/45 backdrop-blur-[2px]">
			<div className="mt-2 flex h-[min(480px,62%)] w-[min(920px,calc(100%-4rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover/95 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.75)] backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-4">
				<header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 pr-2 pl-3 text-xs">
					<SquareTerminal className="size-3.5 text-muted-foreground" />
					<span className="font-medium text-foreground">Quick terminal</span>
					<span className="flex items-center gap-1 rounded-md bg-secondary/70 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
						{session ? (
							<FolderGit2 className="size-3" />
						) : (
							<House className="size-3" />
						)}
						{session ? state.cwd : "~"}
						<ChevronDown className="size-3" />
					</span>
					<div className="ml-auto flex items-center gap-2 text-muted-foreground">
						<span className="flex items-center gap-1">
							<Kbd>⌃</Kbd>
							<Kbd>`</Kbd>
							<span className="ml-0.5">toggle</span>
						</span>
						<span className="flex items-center gap-1">
							<Kbd>esc</Kbd>
							<span className="ml-0.5">hide</span>
						</span>
					</div>
				</header>
				<TerminalScreen
					className="flex-1"
					lines={session ? testLines(state.cwd) : cloneLines()}
				/>
				{session ? null : (
					<div className="flex shrink-0 items-center gap-3 border-t border-border/60 bg-primary/[0.06] px-3 py-2 text-xs">
						<FolderGit2 className="size-3.5 text-primary" />
						<span className="text-muted-foreground">
							You&apos;re in a git repo:{" "}
							<span className="font-mono text-foreground">~/code/acme-web</span>
						</span>
						<button
							className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground"
							type="button"
						>
							Start a session here
							<ArrowRight className="size-3" />
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Concept 4: shell mode in the composer, inline blocks in the transcript
// ---------------------------------------------------------------------------

function ShellBlockHeader({
	command,
	status,
	meta,
	expanded,
}: {
	command: string;
	status: "ok" | "error";
	meta: string;
	expanded: boolean;
}) {
	return (
		<div className="flex items-center gap-2.5 px-3 py-2 text-xs">
			{expanded ? (
				<ChevronDown className="size-3.5 text-muted-foreground" />
			) : (
				<ChevronRight className="size-3.5 text-muted-foreground" />
			)}
			<span className="text-[11px] uppercase tracking-wide text-muted-foreground">
				You ran
			</span>
			<span className="font-mono text-[12.5px] text-foreground">
				<span className="text-emerald-400">$ </span>
				{command}
			</span>
			<span
				className={cn(
					"ml-auto flex items-center gap-1 font-mono text-[11px]",
					status === "ok" ? "text-emerald-400" : "text-red-400",
				)}
			>
				{status === "ok" ? (
					<Check className="size-3" />
				) : (
					<X className="size-3" />
				)}
				{meta}
			</span>
		</div>
	);
}

export function TerminalConceptInlineBlocks() {
	const state = useTerminalConcept();
	if (state?.concept !== 4 || state.scope !== "session") return null;
	return (
		<div className="mt-8 flex flex-col gap-2">
			<div className="rounded-lg border border-border/70 bg-card/30">
				<ShellBlockHeader
					command="bun test"
					expanded={false}
					meta="4 pass · 18ms"
					status="ok"
				/>
			</div>
			<div className="overflow-hidden rounded-lg border border-red-400/25 bg-card/30">
				<ShellBlockHeader
					command="bunx tsc --noEmit"
					expanded
					meta="exit 2 · 1.4s"
					status="error"
				/>
				<TerminalScreen
					className="border-t border-border/60 bg-sidebar/60 py-2.5"
					cursor={false}
					lines={[
						[
							["src/server.ts", C.cwd],
							[":"],
							["21", C.warn],
							[":"],
							["37", C.warn],
							[" - "],
							["error", C.err],
							[" TS2345: ", C.dim],
							[
								"Argument of type 'unknown' is not assignable to parameter of type 'User'.",
							],
						],
						t(""),
						[["21 │", C.dim], ["   const user = createUser(body);"]],
						[
							["   │", C.dim],
							["                           ~~~~", C.err],
						],
						t(""),
						[["Found 1 error in src/server.ts"], [":21", C.dim]],
					]}
				/>
				<div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
					<button
						className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
						type="button"
					>
						<Sparkles className="size-3" />
						Ask Cline to fix
					</button>
					<button
						className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface-hover"
						type="button"
					>
						<Copy className="size-3" />
						Copy output
					</button>
					<span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
						<Eye className="size-3" />
						Cline sees this output with your next message
					</span>
				</div>
			</div>
		</div>
	);
}

export function TerminalConceptShellComposer() {
	const state = useTerminalConcept();
	return (
		<AgentComposer className="border-emerald-400/40 ring-1 ring-emerald-400/15">
			<AgentComposerBody>
				<AgentComposerField className="min-h-16">
					<span className="font-mono text-sm leading-5 text-emerald-400">
						$
					</span>
					<div className="flex-1 font-mono text-sm leading-5 text-foreground">
						bun run dev
						<Cursor />
						<span className="text-muted-foreground/60"> --port 3001</span>
					</div>
					<AgentComposerActions>
						<button
							aria-label="Run command"
							className="flex items-center gap-1 rounded-full bg-emerald-500 p-1.5 text-background"
							type="button"
						>
							<CornerDownLeft className="size-3.5" />
						</button>
					</AgentComposerActions>
				</AgentComposerField>
			</AgentComposerBody>
			<AgentComposerSettings>
				<AgentComposerSettingsGroup>
					<div className="flex items-center rounded-md bg-background/60 p-0.5 text-xs">
						<span className="flex items-center gap-1.5 rounded px-2 py-0.5 text-muted-foreground">
							<MessageSquare className="size-3" />
							Chat
						</span>
						<span className="flex items-center gap-1.5 rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
							<SquareTerminal className="size-3" />
							Shell
						</span>
					</div>
					<span className="flex items-center gap-1.5 font-mono text-[11px]">
						<FolderGit2 className="size-3" />
						{state?.cwd ?? "~"}
					</span>
				</AgentComposerSettingsGroup>
				<AgentComposerSettingsEnd className="text-[11px]">
					<span className="flex items-center gap-1">
						<Kbd>!</Kbd> switch
					</span>
					<span className="flex items-center gap-1">
						<Kbd>esc</Kbd> back to chat
					</span>
				</AgentComposerSettingsEnd>
			</AgentComposerSettings>
		</AgentComposer>
	);
}

// ---------------------------------------------------------------------------
// Concept 5: terminal as a full tab with your shells + Cline's processes
// ---------------------------------------------------------------------------

function ProcessRow({
	title,
	subtitle,
	tone,
	active,
	icon,
}: {
	title: string;
	subtitle: string;
	tone?: "running" | "idle" | "error";
	active?: boolean;
	icon?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex items-start gap-2.5 rounded-md px-2.5 py-2",
				active ? "bg-secondary" : "hover:bg-surface-hover",
			)}
		>
			<span className="mt-1 flex size-3.5 items-center justify-center">
				{icon ?? <StatusDot tone={tone ?? "idle"} />}
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="truncate font-mono text-xs text-foreground">
					{title}
				</span>
				<span className="truncate text-[11px] text-muted-foreground">
					{subtitle}
				</span>
			</span>
		</div>
	);
}

function TerminalWorkspace({ state }: { state: TerminalConceptState }) {
	return (
		<div className="absolute inset-0 z-20 flex bg-background">
			<nav className="flex w-60 shrink-0 flex-col gap-4 border-r border-border bg-sidebar/50 p-2 pt-3">
				<div className="flex flex-col gap-0.5">
					<div className="flex items-center justify-between px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Your terminals
						<Plus className="size-3.5" />
					</div>
					<ProcessRow
						active
						icon={<SquareTerminal className="size-3.5 text-foreground" />}
						subtitle={state.cwd}
						title="zsh"
					/>
					<ProcessRow
						icon={<SquareTerminal className="size-3.5 text-muted-foreground" />}
						subtitle={`${state.cwd}/src`}
						title="zsh"
					/>
				</div>
				<div className="flex flex-col gap-0.5">
					<div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Started by Cline
					</div>
					<ProcessRow
						subtitle="Running · :3000 · 12m"
						title="bun run dev"
						tone="running"
					/>
					<ProcessRow
						subtitle="Exited 0 · 2m ago"
						title="bun test"
						tone="idle"
					/>
					<ProcessRow
						subtitle="Exited 2 · 4m ago"
						title="bunx tsc --noEmit"
						tone="error"
					/>
				</div>
			</nav>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-4 text-xs">
					<SquareTerminal className="size-3.5 text-muted-foreground" />
					<span className="text-foreground">zsh</span>
					<span className="font-mono text-muted-foreground">{state.cwd}</span>
					<div className="ml-auto flex items-center gap-1">
						<IconButton label="Split terminal">
							<Columns2 />
						</IconButton>
						<IconButton label="Kill terminal">
							<X />
						</IconButton>
					</div>
				</div>
				<TerminalScreen
					className="flex-1 px-5 py-4 text-[13px]"
					lines={[
						...testLines(state.cwd).slice(0, -1),
						...curlLines(state.cwd),
					]}
				/>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Layout wrapper around the main content area
// ---------------------------------------------------------------------------

export function TerminalConceptLayout({
	children,
	sessionCwd,
}: {
	children: ReactNode;
	sessionCwd?: string;
}) {
	const [concept, setConcept] = useState<TerminalConcept | null>(null);
	useEffect(() => setConcept(readConceptParam()), []);
	if (!concept) return children;
	const state: TerminalConceptState = {
		concept,
		scope: sessionCwd ? "session" : "home",
		cwd: sessionCwd ? tildify(sessionCwd) : "~",
	};
	return (
		<TerminalConceptContext.Provider value={state}>
			<ConceptFrame state={state}>{children}</ConceptFrame>
		</TerminalConceptContext.Provider>
	);
}

function ConceptFrame({
	children,
	state,
}: {
	children: ReactNode;
	state: TerminalConceptState;
}) {
	const home = state.scope === "home";
	switch (state.concept) {
		case 1:
			return (
				<div className="flex min-h-0 flex-1 flex-col [&_.max-w-240]:pt-[clamp(2rem,9vh,5rem)] [&_[data-welcome-hero]]:hidden">
					{home ? <HomeTitleBarToggle active /> : null}
					{children}
					<BottomPanel state={state} />
				</div>
			);
		case 2:
			return (
				<div className="flex min-h-0 flex-1">
					{home ? <HomeTitleBarToggle active /> : null}
					<div className="flex min-w-0 flex-1 flex-col">{children}</div>
					<RightDock state={state} />
				</div>
			);
		case 3:
			return (
				<div className="relative flex min-h-0 flex-1 flex-col">
					{home ? <HomeTitleBarToggle active={false} /> : null}
					{children}
					<QuickTerminal state={state} />
				</div>
			);
		case 5:
			return home ? (
				children
			) : (
				<div className="relative flex min-h-0 flex-1 flex-col">
					{children}
					<TerminalWorkspace state={state} />
				</div>
			);
		default:
			return children;
	}
}
