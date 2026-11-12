"use client";

import {
	ArrowUpRight,
	CheckCircle2,
	ChevronRight,
	Loader2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChatMessages } from "@/components/views/chat/chat-messages";
import {
	type FactoryLiveActivity,
	useFactoryNow,
} from "@/hooks/use-factory-live-activity";
import {
	type FactorySessionTranscriptStatus,
	useFactorySessionTranscript,
} from "@/hooks/use-factory-session-transcript";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import {
	FACTORY_AGENT_LANES,
	FACTORY_LIVE_TRANSCRIPT,
	FACTORY_PANEL,
	FACTORY_ROLE_LABEL,
} from "@/lib/factory-copy";
import { cn } from "@/lib/utils";
import {
	type FactoryLiveRole,
	type FactoryLiveSession,
	formatFactoryDuration,
	formatFactoryElapsed,
} from "./factory-live";

const ROLE_LABEL: Record<FactoryLiveRole, string> = {
	designer: FACTORY_ROLE_LABEL.designer,
	plan_reviewer: FACTORY_ROLE_LABEL.planReviewer,
	builder: FACTORY_ROLE_LABEL.builder,
	verifier: FACTORY_ROLE_LABEL.verifier,
	reviewer: FACTORY_ROLE_LABEL.reviewer,
};

/**
 * "Builder", or "Plan checker 1" / "Plan checker 2" when a role repeats. A
 * repository stage's session is named by its stage ("Security scan").
 */
export function factoryTranscriptLabels(
	sessions: readonly FactoryLiveSession[],
): Map<string, string> {
	const label = (session: FactoryLiveSession) =>
		session.stage ?? ROLE_LABEL[session.role] ?? session.role;
	const totals = new Map<string, number>();
	for (const session of sessions)
		totals.set(label(session), (totals.get(label(session)) ?? 0) + 1);
	const seen = new Map<string, number>();
	return new Map(
		sessions.map((session) => {
			const name = label(session);
			const index = (seen.get(name) ?? 0) + 1;
			seen.set(name, index);
			return [
				session.sessionId,
				(totals.get(name) ?? 0) > 1 ? `${name} ${index}` : name,
			];
		}),
	);
}

/** The session still working that acted last, else the newest one. */
function defaultSessionId(
	sessions: readonly FactoryLiveSession[],
	activity: FactoryLiveActivity | undefined,
): string | undefined {
	let best: { sessionId: string; at: number } | undefined;
	for (const session of sessions) {
		const entry = activity?.sessions.get(session.sessionId);
		if (!entry || entry.ended) continue;
		if (!best || entry.at > best.at)
			best = { sessionId: session.sessionId, at: entry.at };
	}
	return best?.sessionId ?? sessions.at(-1)?.sessionId;
}

// The first message of a role session is the engine's task prompt, not
// something a person wrote; it stays one click away.
const INITIAL_PROMPT_LABELS = {
	showLabel: FACTORY_LIVE_TRANSCRIPT.showInstructions,
	hideLabel: FACTORY_LIVE_TRANSCRIPT.hideInstructions,
};

const CHAT_STATUS: Record<FactorySessionTranscriptStatus, ChatSessionStatus> = {
	loading: "idle",
	live: "running",
	ended: "completed",
	unavailable: "idle",
};

/**
 * A Factory role agent's conversation, watched from inside its card: the
 * chat's own message rendering in read-only mode, a role switcher when more
 * than one session is known, a quiet state line, and "Open in chat". Fills
 * its parent's height and scrolls on its own, following the bottom while
 * live unless the user scrolled up.
 */
export function FactoryLiveTranscript({
	sessions,
	activity,
	onOpenInChat,
	sessionId,
	className,
}: {
	/** Live or known role sessions, oldest first (`factoryLiveSessions`). */
	sessions: readonly FactoryLiveSession[];
	/** From `useFactoryLiveActivity`; picks the active session and marks
	 * finished or reconnecting ones. */
	activity?: FactoryLiveActivity;
	/** Opens the session in the chat view; the button hides without it. */
	onOpenInChat?: (sessionId: string) => void;
	/**
	 * The session to show, chosen outside (the Agents tab's lanes); the
	 * transcript then has no role switcher of its own.
	 */
	sessionId?: string;
	className?: string;
}) {
	const [picked, setPicked] = useState<string | undefined>();
	const labels = factoryTranscriptLabels(sessions);
	const controlled = sessionId !== undefined && labels.has(sessionId);
	const selectedId = controlled
		? sessionId
		: picked && labels.has(picked)
			? picked
			: defaultSessionId(sessions, activity);
	const selected = sessions.find((session) => session.sessionId === selectedId);
	const transcript = useFactorySessionTranscript(selected?.sessionId, {
		ended: selected
			? activity?.sessions.get(selected.sessionId)?.ended === true
			: false,
	});
	if (!selected) return null;
	const label = labels.get(selected.sessionId) ?? "Agent";
	const reconnecting =
		transcript.status !== "unavailable" &&
		(!transcript.connected || activity?.connected === false);
	const stateLine = reconnecting
		? FACTORY_LIVE_TRANSCRIPT.reconnecting
		: transcript.status === "loading"
			? FACTORY_LIVE_TRANSCRIPT.loading
			: transcript.status === "unavailable"
				? (transcript.error ?? FACTORY_LIVE_TRANSCRIPT.unavailable)
				: transcript.status === "ended"
					? FACTORY_LIVE_TRANSCRIPT.finished(label)
					: FACTORY_LIVE_TRANSCRIPT.live(label);
	// Under the Agents tab's lanes the selected lane already says which role
	// is live or finished; only a loading or broken transcript is worth a line.
	const showState =
		!controlled ||
		reconnecting ||
		transcript.status === "loading" ||
		transcript.status === "unavailable";
	const showMessages = transcript.messages.length > 0;
	return (
		<section
			aria-label={`${label} conversation`}
			className={cn("flex h-full min-h-0 min-w-0 flex-col", className)}
			data-testid="factory-live-transcript"
		>
			<div className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2">
				{sessions.length > 1 && !controlled ? (
					<fieldset className="flex min-w-0 flex-wrap items-center rounded-md border p-0.5">
						<legend className="sr-only">Show the conversation of</legend>
						{sessions.map((session) => (
							<Button
								aria-pressed={session.sessionId === selected.sessionId}
								key={session.sessionId}
								onClick={() => setPicked(session.sessionId)}
								size="xs"
								type="button"
								variant={
									session.sessionId === selected.sessionId
										? "secondary"
										: "ghost"
								}
							>
								{labels.get(session.sessionId)}
							</Button>
						))}
					</fieldset>
				) : null}
				{/* A 9rem basis wraps the line under the role switcher in a narrow
				    panel instead of truncating "Live · Builder" to "Live…". */}
				{showState ? (
					<p
						className="flex min-w-0 flex-1 basis-36 items-center gap-1.5 text-xs text-muted-foreground"
						data-testid="factory-live-transcript-state"
						title={stateLine}
					>
						{transcript.status === "live" && !reconnecting ? (
							<span
								aria-hidden
								className="size-1.5 shrink-0 rounded-full bg-emerald-500"
							/>
						) : null}
						{transcript.status === "loading" || reconnecting ? (
							<Loader2 aria-hidden className="size-3 shrink-0 animate-spin" />
						) : null}
						<span className="min-w-0 truncate">{stateLine}</span>
					</p>
				) : null}
				{onOpenInChat ? (
					<Button
						className="ml-auto shrink-0"
						onClick={() => onOpenInChat(selected.sessionId)}
						size="xs"
						type="button"
						variant="outline"
					>
						Open in chat
						<ArrowUpRight className="size-3.5" />
					</Button>
				) : null}
			</div>
			{/* The scroller itself is not a live region; only the state line
			    above changes in words, so screen readers are not read every
			    streamed row. */}
			<div aria-live="off" className="min-h-0 flex-1">
				{showMessages ? (
					<ChatMessages
						chatTransportState="connected"
						collapseInitialPrompt={INITIAL_PROMPT_LABELS}
						compact
						error={null}
						messages={transcript.messages}
						readOnly
						sessionId={selected.sessionId}
						status={CHAT_STATUS[transcript.status]}
					/>
				) : transcript.status === "live" || transcript.status === "ended" ? (
					<p className="p-6 text-sm text-muted-foreground">
						{FACTORY_LIVE_TRANSCRIPT.noMessages}
					</p>
				) : null}
			</div>
		</section>
	);
}

/** One role session of a card, as its lane in the Agents tab shows it. */
export type FactoryAgentLane = {
	session: FactoryLiveSession;
	label: string;
	running: boolean;
	/** Epoch ms the session started, when known. */
	startedAt?: number;
	/** Epoch ms the session finished, when known. */
	endedAt?: number;
};

const parseTime = (value: string | undefined) => {
	const time = value ? Date.parse(value) : Number.NaN;
	return Number.isFinite(time) ? time : undefined;
};

/**
 * The card's lanes: running sessions first (oldest first), then finished
 * ones, most recently finished first. A session is running while the run
 * says so and live activity has not seen it end.
 */
export function factoryAgentLanes(
	sessions: readonly FactoryLiveSession[],
	runningIds: ReadonlySet<string>,
	activity: FactoryLiveActivity | undefined,
): FactoryAgentLane[] {
	const labels = factoryTranscriptLabels(sessions);
	const lanes = sessions.map((session): FactoryAgentLane => {
		const entry = activity?.sessions.get(session.sessionId);
		const running = runningIds.has(session.sessionId) && !entry?.ended;
		return {
			session,
			label: labels.get(session.sessionId) ?? session.role,
			running,
			startedAt: parseTime(session.startedAt),
			endedAt: running
				? undefined
				: (parseTime(session.endedAt) ?? (entry?.ended ? entry.at : undefined)),
		};
	});
	return [
		...lanes.filter((lane) => lane.running),
		...lanes
			.filter((lane) => !lane.running)
			.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)),
	];
}

/**
 * The Agents tab: one lane per role session of the card, running ones first,
 * each with its role, model when known, current activity and elapsed time;
 * finished lanes fold to one line. Selecting a lane shows its read-only
 * transcript below. With nothing running it says the last fact.
 */
export function FactoryAgentLanes({
	sessions,
	runningIds,
	activity,
	waiting,
	onOpenInChat,
}: {
	/** Every role session known for the card (`factoryKnownSessions`). */
	sessions: readonly FactoryLiveSession[];
	/** Sessions the run or scoping says are working now. */
	runningIds: ReadonlySet<string>;
	activity?: FactoryLiveActivity;
	/** Shown when nothing runs yet, e.g. "Waiting for a free slot". */
	waiting?: string;
	onOpenInChat?: (sessionId: string) => void;
}) {
	const lanes = factoryAgentLanes(sessions, runningIds, activity);
	const anyRunning = lanes.some((lane) => lane.running);
	const now = useFactoryNow(anyRunning);
	const [picked, setPicked] = useState<string>();
	const selected =
		lanes.find((lane) => lane.session.sessionId === picked) ?? lanes[0];
	const last = lanes.find((lane) => !lane.running && lane.endedAt);
	const idle = anyRunning
		? undefined
		: (waiting ??
			FACTORY_PANEL.liveIdle(
				last?.endedAt
					? {
							role: last.label,
							ago: formatFactoryDuration(now - last.endedAt),
						}
					: undefined,
			));
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="factory-agents">
			{idle ? (
				<p
					className="border-b px-3 py-2 text-sm text-muted-foreground"
					data-testid="factory-agents-idle"
				>
					{idle}
				</p>
			) : null}
			{lanes.length ? (
				<ul
					aria-label={FACTORY_AGENT_LANES.label}
					className="max-h-[40%] shrink-0 divide-y overflow-y-auto border-b"
				>
					{lanes.map((lane) => {
						const entry = activity?.sessions.get(lane.session.sessionId);
						const isSelected =
							lane.session.sessionId === selected?.session.sessionId;
						const duration =
							lane.startedAt !== undefined
								? lane.running
									? formatFactoryElapsed(now - lane.startedAt)
									: lane.endedAt !== undefined
										? formatFactoryDuration(lane.endedAt - lane.startedAt)
										: undefined
								: undefined;
						return (
							<li key={lane.session.sessionId}>
								<button
									type="button"
									aria-pressed={isSelected}
									aria-label={FACTORY_AGENT_LANES.select(lane.label)}
									data-testid="factory-agent-lane"
									data-running={lane.running || undefined}
									onClick={() => setPicked(lane.session.sessionId)}
									className={cn(
										"flex w-full min-w-0 items-start gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
										isSelected && "bg-muted/60",
									)}
								>
									{lane.running ? (
										<span
											aria-hidden
											className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500 motion-safe:animate-pulse"
										/>
									) : (
										<CheckCircle2
											aria-hidden
											className="mt-0.5 size-3 shrink-0 text-muted-foreground"
										/>
									)}
									{lane.running ? (
										<span className="min-w-0 flex-1 space-y-0.5">
											<span className="flex min-w-0 items-baseline gap-1.5">
												<span className="shrink-0 font-medium text-foreground">
													{lane.label}
												</span>
												{lane.session.model ? (
													<span className="min-w-0 truncate font-mono text-muted-foreground">
														{lane.session.model}
													</span>
												) : null}
												{duration ? (
													<span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
														{duration}
													</span>
												) : null}
											</span>
											<span className="block truncate text-muted-foreground">
												{entry?.lastTool ??
													(entry
														? FACTORY_AGENT_LANES.working
														: FACTORY_AGENT_LANES.starting)}
											</span>
										</span>
									) : (
										<span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-muted-foreground">
											<span className="min-w-0 truncate">
												{FACTORY_AGENT_LANES.finished(lane.label, duration)}
											</span>
											{lane.session.model ? (
												<span className="ml-auto min-w-0 shrink truncate font-mono">
													{lane.session.model}
												</span>
											) : null}
										</span>
									)}
									<ChevronRight
										aria-hidden
										className={cn(
											"mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
											isSelected && "rotate-90",
										)}
									/>
								</button>
							</li>
						);
					})}
				</ul>
			) : null}
			{selected ? (
				<FactoryLiveTranscript
					className="min-h-0 flex-1"
					sessions={sessions}
					sessionId={selected.session.sessionId}
					activity={activity}
					onOpenInChat={onOpenInChat}
				/>
			) : null}
		</div>
	);
}
