"use client";

import { SessionStatus } from "@cline/ui";
import {
	AlertCircle,
	Bot,
	Check,
	ChevronRight,
	Clock3,
	CornerUpLeft,
	Loader2,
	MoreHorizontal,
	Plus,
	Trash2,
} from "lucide-react";
import { type CSSProperties, memo, useEffect, useMemo, useState } from "react";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import {
	agentEntryState,
	describeAgentActivity,
	type SessionAgentActivity,
	type SessionAgentEntry,
	type SessionAgentRunState,
} from "@/lib/session-agents";
import { sessionStatusColor, sessionStatusTone } from "@/lib/session-status";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { normalizeTitle } from "./utils";

type AgentHeaderProps = {
	title?: string;
	canEditTitle?: boolean;
	renamingTitle?: boolean;
	onRenameTitle?: (nextTitle: string) => Promise<void> | void;
	onNewThread?: () => void;
	onDeleteSession?: () => void;
	canDeleteSession?: boolean;
	deletingSession?: boolean;
	onOpenDiff?: () => void;
	showSessionActions?: boolean;
	status?: ChatSessionStatus;
	diff?: {
		additions: number;
		deletions: number;
	};
	agentActivity?: SessionAgentActivity;
	agents?: SessionAgentEntry[];
	agentsLoading?: boolean;
	agentsError?: string | null;
	onAgentsOpenChange?: (open: boolean) => void;
	onOpenAgentSession?: (agentSessionId: string) => void | Promise<void>;
	/** Set when the open session is itself a child agent run. */
	parentSession?: { sessionId: string; title?: string };
	onOpenParentSession?: (parentSessionId: string) => void | Promise<void>;
};

function AgentHeaderImpl({
	title,
	canEditTitle,
	renamingTitle,
	onRenameTitle,
	onNewThread,
	onDeleteSession,
	canDeleteSession,
	deletingSession,
	onOpenDiff,
	showSessionActions = true,
	status,
	diff,
	agentActivity,
	agents,
	agentsLoading = false,
	agentsError = null,
	onAgentsOpenChange,
	onOpenAgentSession,
	parentSession,
	onOpenParentSession,
}: AgentHeaderProps) {
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const [titleInput, setTitleInput] = useState("");
	const [titleEditorWidth, setTitleEditorWidth] = useState<number>();
	const additions = diff?.additions ?? 0;
	const deletions = diff?.deletions ?? 0;
	const hasChanges = additions + deletions > 0;
	const statusTone = sessionStatusTone(status);
	const statusColor = sessionStatusColor(status);
	const threadTitle = useMemo(
		() => normalizeTitle(title?.trim()) || "New Session",
		[title],
	);

	useEffect(() => {
		if (!isEditingTitle) {
			setTitleInput(threadTitle);
		}
	}, [isEditingTitle, threadTitle]);

	const submitTitle = async () => {
		if (!onRenameTitle || renamingTitle) {
			return;
		}
		const nextTitle = titleInput.trim();
		if (nextTitle === threadTitle.trim()) {
			setIsEditingTitle(false);
			return;
		}
		setIsEditingTitle(false);
		try {
			await onRenameTitle(nextTitle);
		} catch {
			// Keep the existing title when update fails.
		}
	};

	const triggerDeleteSession = () => onDeleteSession?.();

	return (
		<header
			className="flex h-12 items-center justify-between gap-2 px-4 max-md:h-7 max-md:pl-28 md:group-data-[state=collapsed]/sidebar-wrapper:pl-7"
			data-tauri-drag-region="deep"
		>
			{/* Left: thread title */}
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<SessionStatus
					className="shrink-0 font-mono"
					label={`Session status: ${status}`}
					showLabel={false}
					style={
						{
							"--cline-ui-session-status-color": statusColor,
						} as CSSProperties
					}
					tone={statusTone}
				/>
				{!canEditTitle ? (
					<span
						className="min-w-0 truncate text-sm font-medium text-foreground"
						title={threadTitle}
					>
						{threadTitle}
					</span>
				) : isEditingTitle ? (
					<form
						className="m-0 min-w-0 max-w-full shrink-0"
						onSubmit={(event) => {
							event.preventDefault();
							void submitTitle();
						}}
						style={{ width: titleEditorWidth }}
					>
						<Input
							autoFocus
							className="h-7 w-full text-sm"
							disabled={renamingTitle}
							onBlur={() => {
								void submitTitle();
							}}
							onChange={(event) => setTitleInput(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									setTitleInput(threadTitle);
									setIsEditingTitle(false);
								}
							}}
							value={titleInput}
						/>
					</form>
				) : (
					<button
						className={cn(
							"min-w-0 truncate text-sm font-medium text-foreground",
							canEditTitle &&
								"rounded px-1 py-0.5 transition-colors hover:bg-surface-hover",
						)}
						disabled={renamingTitle}
						onClick={(event) => {
							if (!canEditTitle || renamingTitle) {
								return;
							}
							setTitleEditorWidth(
								event.currentTarget.getBoundingClientRect().width,
							);
							setTitleInput(threadTitle);
							setIsEditingTitle(true);
						}}
						type="button"
						title={threadTitle}
					>
						{threadTitle}
					</button>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							aria-label="Session actions"
							className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
							id="show-more-btn"
							variant="ghost"
							size="icon-sm"
							type="button"
						>
							<MoreHorizontal className="size-3" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-44">
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							disabled={!canDeleteSession || deletingSession}
							onClick={triggerDeleteSession}
						>
							<Trash2 className="size-4" />
							<span>{deletingSession ? "Deleting..." : "Delete session"}</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{showSessionActions ? (
				<div className="flex shrink-0 items-center gap-2">
					<AgentActivityStatus
						activity={agentActivity}
						agents={agents}
						error={agentsError}
						loading={agentsLoading}
						onOpenAgentSession={onOpenAgentSession}
						onOpenChange={onAgentsOpenChange}
					/>
					{additions !== 0 && (
						<Button
							aria-label={`Open diff: ${additions} additions, ${deletions} deletions`}
							className={cn(
								"flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-mono transition-colors",
								hasChanges
									? "hover:bg-secondary/80"
									: "cursor-default opacity-60",
							)}
							disabled={!hasChanges}
							id="diff-stats"
							onClick={() => onOpenDiff?.()}
							size="sm"
							type="button"
							variant="secondary"
						>
							<span className="text-chart-2">+{additions}</span>
							<span className="text-destructive">-{deletions}</span>
						</Button>
					)}
					{/* A child agent run leads back to its parent instead of starting a
					    new session: "new session" is a top-level action that does not
					    belong to a run nested inside another one. */}
					{parentSession ? (
						<SubagentSessionBadge
							onOpenParentSession={onOpenParentSession}
							parentSession={parentSession}
						/>
					) : (
						<Button
							aria-label="New session"
							className="flex items-center gap-1 rounded-md text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
							onClick={() => onNewThread?.()}
							size="icon-sm"
							variant="ghost"
						>
							<Plus className="size-4" />
						</Button>
					)}
				</div>
			) : null}
		</header>
	);
}

// Memoized: the header sits above the streaming conversation and would
// otherwise re-render on every stream flush; its props are kept
// referentially stable by the chat pane.
export const AgentHeader = memo(AgentHeaderImpl);

/**
 * Route from a child agent run back to the session that spawned it, in the
 * header slot the "new session" button occupies elsewhere.
 *
 * Child sessions are deliberately absent from the sidebar, so this is the only
 * route back — without it the user would have to hunt for the main session.
 * The parent's own title goes in the tooltip rather than the label, which stays
 * fixed so the control reads the same on every child run.
 */
function SubagentSessionBadge({
	parentSession,
	onOpenParentSession,
}: {
	parentSession: { sessionId: string; title?: string };
	onOpenParentSession?: (parentSessionId: string) => void | Promise<void>;
}) {
	const parentTitle = parentSession.title?.trim();
	const label = "Main Agent Session";
	const hint = parentTitle
		? `Back to the main agent session: ${parentTitle}`
		: "Back to the main agent session";

	return (
		<Button
			aria-label={hint}
			className="h-7 shrink-0 gap-1 rounded-md text-xs font-normal text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
			disabled={!onOpenParentSession}
			id="subagent-session-badge"
			onClick={() => void onOpenParentSession?.(parentSession.sessionId)}
			size="sm"
			title={hint}
			type="button"
			variant="ghost"
		>
			<CornerUpLeft aria-hidden="true" className="size-3 shrink-0" />
			<Bot aria-hidden="true" className="size-3 shrink-0" />
			<span className="max-w-40 truncate">{label}</span>
		</Button>
	);
}

/**
 * Compact tally of the subagents / teammates a session has started, sitting
 * beside the diff stats and opening a roster popover. Hidden entirely for
 * sessions that never spawned one, and each bucket is omitted while it is empty
 * so the common single-state case reads as one number.
 */
function AgentActivityStatus({
	activity,
	agents,
	loading = false,
	error = null,
	onOpenChange,
	onOpenAgentSession,
}: {
	activity?: SessionAgentActivity;
	agents?: SessionAgentEntry[];
	loading?: boolean;
	error?: string | null;
	onOpenChange?: (open: boolean) => void;
	onOpenAgentSession?: (agentSessionId: string) => void | Promise<void>;
}) {
	// Controlled so selecting an agent can dismiss the popover as the session view
	// takes over; an uncontrolled one would linger over the newly opened session.
	const [open, setOpen] = useState(false);

	if (!activity || activity.total === 0) {
		return null;
	}
	const label = describeAgentActivity(activity);
	const stalled = activity.cancelled + activity.unresolved;

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		onOpenChange?.(next);
	};

	return (
		<Popover onOpenChange={handleOpenChange} open={open}>
			<PopoverTrigger asChild>
				<Button
					aria-label={label}
					className="flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs font-mono text-muted-foreground transition-colors hover:bg-secondary/80"
					id="agent-activity"
					size="sm"
					title={label}
					type="button"
					variant="secondary"
				>
					<Bot aria-hidden="true" className="size-3 shrink-0" />
					<span className="text-foreground">{activity.total}</span>
					{activity.running > 0 ? (
						<span className="flex items-center gap-0.5 text-foreground">
							<Loader2 aria-hidden="true" className="size-3 animate-spin" />
							{activity.running}
						</span>
					) : null}
					{activity.completed > 0 ? (
						<span className="flex items-center gap-0.5 text-chart-2">
							<Check aria-hidden="true" className="size-3" />
							{activity.completed}
						</span>
					) : null}
					{activity.failed > 0 ? (
						<span className="flex items-center gap-0.5 text-destructive">
							<AlertCircle aria-hidden="true" className="size-3" />
							{activity.failed}
						</span>
					) : null}
					{stalled > 0 ? (
						<span className="flex items-center gap-0.5">
							<Clock3 aria-hidden="true" className="size-3" />
							{stalled}
						</span>
					) : null}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-96 max-w-[calc(100vw-2rem)] overflow-hidden p-0"
				id="agent-activity-panel"
			>
				<div className="border-b border-border/70 px-3 py-2">
					<div className="text-sm font-medium text-foreground">Agents</div>
					<div className="mt-0.5 text-[11px] text-muted-foreground">
						{label}
					</div>
				</div>
				<AgentRoster
					activity={activity}
					agents={agents ?? []}
					error={error}
					loading={loading}
					onSelect={(agentSessionId) => {
						handleOpenChange(false);
						void onOpenAgentSession?.(agentSessionId);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

function AgentRoster({
	activity,
	agents,
	loading,
	error,
	onSelect,
}: {
	activity: SessionAgentActivity;
	agents: SessionAgentEntry[];
	loading: boolean;
	error: string | null;
	onSelect: (agentSessionId: string) => void;
}) {
	if (loading && agents.length === 0) {
		return (
			<div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
				<Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
				Loading agents...
			</div>
		);
	}

	if (agents.length === 0) {
		// The tally saw spawns the backend has not recorded yet, or cannot record
		// (a host without a session database). Say which, rather than "none".
		return (
			<div className="px-3 py-4 text-xs text-muted-foreground">
				{activity.running > 0
					? "Waiting for the first agent to report in..."
					: "No agent details were recorded for this session."}
				{error ? (
					<div className="mt-1 text-[11px] text-muted-foreground/80">
						{error}
					</div>
				) : null}
			</div>
		);
	}

	return (
		<>
			{/* A plain scroller rather than ScrollArea: Radix's viewport wraps content
			    in a `display: table` element, which sizes to its widest line and
			    pushes long prompts past the popover edge instead of wrapping them. */}
			<div className="max-h-80 overflow-y-auto overscroll-contain">
				<ul className="divide-y divide-border/60">
					{agents.map((agent) => (
						<AgentRosterRow
							agent={agent}
							key={agent.sessionId}
							onSelect={() => onSelect(agent.sessionId)}
						/>
					))}
				</ul>
			</div>
			{/* A failed refresh keeps the last good list rather than blanking it, so
			    say so — otherwise stale rows would pass for current ones. */}
			{error ? (
				<div
					className="border-t border-border/70 px-3 py-2 text-[11px] text-muted-foreground"
					id="agent-roster-stale"
				>
					Could not refresh — showing the last known agents. {error}
				</div>
			) : null}
		</>
	);
}

const AGENT_STATE_ICON: Record<SessionAgentRunState, typeof Check> = {
	running: Loader2,
	completed: Check,
	failed: AlertCircle,
	cancelled: Clock3,
	unresolved: Clock3,
};

const AGENT_STATE_CLASS: Record<SessionAgentRunState, string> = {
	running: "text-foreground",
	completed: "text-chart-2",
	failed: "text-destructive",
	cancelled: "text-muted-foreground",
	unresolved: "text-muted-foreground",
};

/**
 * One agent, identified by the task it was given rather than its generated id —
 * `agent_1784837087669_01o5io` tells the reader nothing. The second line tracks
 * the most recent step so a running agent shows progress, and selecting the row
 * opens that agent's own session.
 */
function AgentRosterRow({
	agent,
	onSelect,
}: {
	agent: SessionAgentEntry;
	onSelect: () => void;
}) {
	const state = agentEntryState(agent.status);
	const StateIcon = AGENT_STATE_ICON[state];
	const isRunning = state === "running";
	const task = agent.prompt?.trim();
	const lastAction = agent.lastAction?.trim();

	return (
		<li>
			<button
				className="flex w-full min-w-0 items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-hover"
				onClick={onSelect}
				title="Open this agent's session"
				type="button"
			>
				<StateIcon
					aria-hidden="true"
					className={cn(
						"mt-0.5 size-3.5 shrink-0",
						AGENT_STATE_CLASS[state],
						isRunning && "animate-spin",
					)}
				/>
				{/* flex-col so each line is a block that honours the popover width;
				    min-w-0 lets the clamp/truncate win over the text's intrinsic size. */}
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="line-clamp-2 wrap-break-word text-xs font-medium text-foreground">
						{task || "Untitled task"}
					</span>
					<span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
						{agent.kind === "teamtask" ? (
							<span className="shrink-0 text-[10px] uppercase tracking-wide">
								{agent.teamName ? `team ${agent.teamName}` : "team"}
							</span>
						) : null}
						<span
							className={cn("min-w-0 truncate", !lastAction && "italic")}
							title={lastAction || undefined}
						>
							{lastAction ||
								(isRunning
									? "Starting up..."
									: `No activity recorded (${state})`)}
						</span>
					</span>
				</span>
				<ChevronRight
					aria-hidden="true"
					className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60"
				/>
			</button>
		</li>
	);
}
