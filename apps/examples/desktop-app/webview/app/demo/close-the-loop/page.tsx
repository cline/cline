"use client";

import { SessionStatus } from "@cline/ui";
import {
	ArrowLeft,
	Cloud,
	FlaskConical,
	GitBranch,
	RotateCcw,
	SkipForward,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChatMessages } from "@/components/views/chat/chat-messages";
import type { ChatMessage, ChatSessionStatus } from "@/lib/chat-schema";
import {
	DEMO_BRANCH,
	DEMO_NARRATION,
	DEMO_REPO,
	DEMO_SCRIPT,
	DEMO_SESSION_ID,
	type DemoBeat,
} from "@/lib/close-the-loop-demo";
import { cn } from "@/lib/utils";

type DemoState = {
	messages: ChatMessage[];
	status: ChatSessionStatus;
	streamingMessageId: string | null;
	narration: number;
	finished: boolean;
};

const INITIAL_STATE: DemoState = {
	messages: [],
	status: "idle",
	streamingMessageId: null,
	narration: 0,
	finished: false,
};

function applyBeat(state: DemoState, beat: DemoBeat): DemoState {
	const narration = "narration" in beat ? beat.narration : undefined;
	const next: DemoState = {
		...state,
		narration: narration ?? state.narration,
	};
	if ("append" in beat) {
		next.messages = [...state.messages, beat.append];
	} else if ("patch" in beat) {
		next.messages = state.messages.map((message) =>
			message.id === beat.patch.id
				? {
						...message,
						...beat.patch,
						meta: { ...message.meta, ...beat.patch.meta },
					}
				: message,
		);
	} else if ("status" in beat) {
		next.status = beat.status;
	} else if ("streaming" in beat) {
		next.streamingMessageId = beat.streaming;
	}
	return next;
}

/** Walks the scripted beats on a timer; `skip` flushes the rest instantly. */
function useDemoPlayer() {
	const [state, setState] = useState<DemoState>(INITIAL_STATE);
	const [run, setRun] = useState(0);
	const cursorRef = useRef(0);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// biome-ignore lint/correctness/useExhaustiveDependencies: run is the replay trigger, not a value the effect reads
	useEffect(() => {
		cursorRef.current = 0;
		setState(INITIAL_STATE);
		const schedule = () => {
			const beat = DEMO_SCRIPT[cursorRef.current];
			if (!beat) {
				setState((current) => ({ ...current, finished: true }));
				return;
			}
			timerRef.current = setTimeout(() => {
				cursorRef.current += 1;
				setState((current) => applyBeat(current, beat));
				schedule();
			}, beat.delay);
		};
		schedule();
		return () => clearTimeout(timerRef.current);
	}, [run]);

	const replay = useCallback(() => setRun((value) => value + 1), []);
	const skip = useCallback(() => {
		clearTimeout(timerRef.current);
		const remaining = DEMO_SCRIPT.slice(cursorRef.current);
		cursorRef.current = DEMO_SCRIPT.length;
		setState((current) => ({
			...remaining.reduce(applyBeat, current),
			finished: true,
		}));
	}, []);

	return { state, replay, skip };
}

const noop = () => {};

export default function CloseTheLoopDemoPage() {
	const { state, replay, skip } = useDemoPlayer();
	const narration = DEMO_NARRATION[state.narration] ?? DEMO_NARRATION[0];
	const statusLabel = useMemo(() => {
		switch (state.status) {
			case "running":
				return { label: "Running in sandbox", tone: "running" as const };
			case "completed":
				return { label: "Completed", tone: "neutral" as const };
			default:
				return { label: "Starting sandbox", tone: "neutral" as const };
		}
	}, [state.status]);

	return (
		<div className="flex h-dvh flex-col bg-background text-foreground">
			<header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-3">
				<Button
					onClick={() => window.location.assign("/")}
					size="sm"
					type="button"
					variant="ghost"
				>
					<ArrowLeft />
					Back to Cline
				</Button>
				<div className="flex min-w-0 items-center gap-2 text-sm">
					<span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-medium">
						<Cloud className="size-3.5 text-muted-foreground" />
						{DEMO_REPO}
					</span>
					<span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-mono text-xs text-muted-foreground">
						<GitBranch className="size-3.5" />
						{DEMO_BRANCH}
					</span>
				</div>
				<div className="flex items-center gap-3">
					<SessionStatus label={statusLabel.label} tone={statusLabel.tone} />
					<span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
						<FlaskConical className="size-3" />
						Prototype · canned data
					</span>
				</div>
			</header>

			<main className="min-h-0 flex-1">
				<ChatMessages
					chatTransportState="connected"
					error={null}
					messages={state.messages}
					onAnswerAskQuestion={noop}
					onApproveToolApproval={noop}
					onRejectToolApproval={noop}
					pendingAskQuestions={[]}
					pendingToolApprovals={[]}
					sessionId={DEMO_SESSION_ID}
					startingLabel={
						state.status === "running" ? undefined : "Provisioning sandbox..."
					}
					status={state.status}
					streamingMessageId={state.streamingMessageId}
				/>
			</main>

			<footer className="shrink-0 px-4 pb-4">
				<div
					className={cn(
						"mx-auto flex w-full max-w-3xl items-start gap-4 rounded-2xl border p-4 shadow-lg backdrop-blur",
						narration.eyebrow === "Next"
							? "border-violet-500/40 bg-gradient-to-r from-violet-500/15 via-fuchsia-500/10 to-transparent"
							: "border-border bg-card/80",
					)}
				>
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<div className="flex items-center gap-2">
							<div className="flex items-center gap-1" aria-hidden>
								{DEMO_NARRATION.map((item, index) => (
									<span
										className={cn(
											"h-1.5 rounded-full transition-all duration-300",
											index === state.narration
												? "w-5 bg-violet-500"
												: index < state.narration
													? "w-1.5 bg-violet-500/60"
													: "w-1.5 bg-muted-foreground/30",
										)}
										key={item.title}
									/>
								))}
							</div>
							<span
								className={cn(
									"text-[11px] font-semibold uppercase tracking-wider",
									narration.eyebrow === "Next"
										? "text-violet-600 dark:text-violet-300"
										: "text-muted-foreground",
								)}
							>
								{narration.eyebrow}
							</span>
							<span className="text-[11px] text-muted-foreground">
								{state.narration + 1} / {DEMO_NARRATION.length}
							</span>
						</div>
						<div
							className="animate-in fade-in slide-in-from-bottom-1 duration-300"
							key={state.narration}
						>
							<p className="text-sm font-semibold leading-5">
								{narration.title}
							</p>
							<p className="text-sm text-muted-foreground">{narration.body}</p>
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						{state.finished ? null : (
							<Button onClick={skip} size="sm" type="button" variant="outline">
								<SkipForward />
								Skip to result
							</Button>
						)}
						<Button
							onClick={replay}
							size="sm"
							type="button"
							variant={state.finished ? "default" : "ghost"}
						>
							<RotateCcw />
							Replay
						</Button>
					</div>
				</div>
			</footer>
		</div>
	);
}
