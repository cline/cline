"use client";

import {
	AgentComposer,
	AgentComposerBody,
	AgentConversationLayout,
} from "@cline/ui";
import {
	MessageScroller,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@cline/ui/components/message-scroller";
import {
	Loader2,
	PanelRightClose,
	PanelRightOpen,
	RotateCcw,
	Users,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AgentHeader } from "@/components/agent-header";
import { Button } from "@/components/ui/button";
import { WindowTitleBarContent } from "@/components/window-title-bar";
import type { ChatMessage } from "@/lib/chat-schema";
import type {
	SessionAgentActivity,
	SessionAgentEntry,
} from "@/lib/session-agents";
import { STREAMING_TITLE_CLASS } from "../messages/constants";
import { MessageBubble } from "../messages/message-bubble";
import { ToolMessageBlock } from "../messages/tool-message-block";
import { MissionControl } from "./mission-control";
import { isActiveStatus, TeamLanesCard, TeamPlanCard } from "./team-cards";
import {
	buildBeats,
	type DemoSnapshot,
	initialSnapshot,
	PROMPT,
	SESSION_ID,
	TITLE,
} from "./team-script";

/*
 * Scripted preview of an agent team breaking down a large task. The inline
 * plan and lane cards and the Mission control panel all render the same team
 * state, which mirrors the SDK's team model.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function useTeamPlayback(run: number): DemoSnapshot {
	const [snapshot, setSnapshot] = useState(initialSnapshot);
	useEffect(() => {
		void run;
		let cancelled = false;
		let clock = Date.now() - 6 * 60_000;
		let state = initialSnapshot();
		const commit = (mutate: (draft: DemoSnapshot) => void) => {
			const next = structuredClone(state);
			mutate(next);
			state = next;
			setSnapshot(next);
		};
		const message = (
			id: string,
			role: ChatMessage["role"],
			content: string,
			meta?: ChatMessage["meta"],
		): ChatMessage => ({
			id,
			sessionId: SESSION_ID,
			role,
			content,
			createdAt: clock,
			meta,
		});
		const toolMessage = (
			id: string,
			tool: string,
			input: unknown,
			result: unknown,
			running: boolean,
		) =>
			message(
				id,
				"tool",
				JSON.stringify({
					toolName: tool,
					input,
					result: running ? null : result,
				}),
				{
					toolName: tool,
					toolCallId: id,
					...(running ? { hookEventName: "tool_call_start" } : {}),
				},
			);
		const replaceMessage = (next: ChatMessage) =>
			commit((draft) => {
				draft.transcript = draft.transcript.map((item) =>
					item.kind === "message" && item.message.id === next.id
						? { ...item, message: next }
						: item,
				);
			});
		const refs = new Map<
			string,
			{ id: string; tool: string; input: unknown }
		>();

		void (async () => {
			commit((draft) => {
				draft.team.startedAt = Date.now();
				draft.transcript.push({
					kind: "message",
					message: message("prompt", "user", PROMPT),
				});
			});
			let index = 0;
			for (const beat of buildBeats()) {
				await sleep(beat.wait);
				if (cancelled) return;
				clock += beat.wait * 8;
				const id = `beat-${index++}`;
				if (beat.do) commit((draft) => beat.do?.(draft, clock));
				if (beat.complete) {
					const ref = refs.get(beat.complete.ref);
					if (ref)
						replaceMessage(
							toolMessage(
								ref.id,
								ref.tool,
								ref.input,
								beat.complete.result,
								false,
							),
						);
				}
				if (beat.tool) {
					const { tool, input, result, runMs, ref } = beat.tool;
					commit((draft) => {
						draft.transcript.push({
							kind: "message",
							message: toolMessage(id, tool, input, result, true),
						});
					});
					if (ref) refs.set(ref, { id, tool, input });
					if (runMs !== undefined) {
						await sleep(runMs);
						if (cancelled) return;
						replaceMessage(toolMessage(id, tool, input, result, false));
					}
				}
				if (beat.say) {
					const { text, reasoning, thoughtMs, stream } = beat.say;
					commit((draft) => {
						draft.transcript.push({
							kind: "message",
							message: message(id, "assistant", stream ? "" : text),
							reasoning,
							thoughtMs,
						});
						if (stream) draft.streamingMessageId = id;
					});
					if (stream) {
						const words = text.split(/(?<=\s)/);
						for (let count = 3; count < words.length + 3; count += 3) {
							await sleep(40);
							if (cancelled) return;
							replaceMessage(
								message(id, "assistant", words.slice(0, count).join("")),
							);
						}
						commit((draft) => {
							draft.streamingMessageId = null;
						});
					}
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [run]);
	return snapshot;
}

type Row =
	| {
			kind: "message";
			key: string;
			message: ChatMessage;
			reasoning?: string;
			thoughtMs?: number;
	  }
	| { kind: "tools"; key: string; messages: ChatMessage[] }
	| { kind: "plan"; key: string }
	| { kind: "lanes"; key: string };

function toRows(snapshot: DemoSnapshot): Row[] {
	const rows: Row[] = [];
	for (const item of snapshot.transcript) {
		if (item.kind !== "message") {
			rows.push({ kind: item.kind, key: item.kind });
			continue;
		}
		const last = rows.at(-1);
		if (item.message.role === "tool") {
			if (last?.kind === "tools") last.messages.push(item.message);
			else
				rows.push({
					kind: "tools",
					key: `tools-${item.message.id}`,
					messages: [item.message],
				});
			continue;
		}
		rows.push({
			kind: "message",
			key: item.message.id,
			message: item.message,
			reasoning: item.reasoning,
			thoughtMs: item.thoughtMs,
		});
	}
	return rows;
}

export function TeamDemo({ onExit }: { onExit: () => void }) {
	const [run, setRun] = useState(0);
	const snapshot = useTeamPlayback(run);
	const [missionControlOpen, setMissionControlOpen] = useState(false);
	const [focusedMember, setFocusedMember] = useState<string | null>(null);
	const { team, status, streamingMessageId } = snapshot;
	const rows = useMemo(() => toRows(snapshot), [snapshot]);
	const running = status === "starting" || status === "running";
	const lastMessage = [...snapshot.transcript]
		.reverse()
		.find((item) => item.kind === "message");

	const teammates = team.members.filter((m) => !m.lead);
	const activity: SessionAgentActivity = {
		total: teammates.length,
		running: teammates.filter((m) => m.status !== "done").length,
		completed: teammates.filter((m) => m.status === "done").length,
		failed: 0,
		cancelled: 0,
		unresolved: 0,
	};
	const agents: SessionAgentEntry[] = teammates.map((m) => ({
		sessionId: m.id,
		agentId: m.id,
		kind: "teamtask",
		status: m.status === "done" ? "completed" : "running",
		prompt: m.role,
		lastAction: m.activity,
		teamName: team.name,
		startedAt: new Date(team.startedAt).toISOString(),
		hasMessages: true,
	}));
	const focus = (id: string | null) => {
		setFocusedMember(id);
		if (id) setMissionControlOpen(true);
	};
	const replay = () => {
		setFocusedMember(null);
		setRun((value) => value + 1);
	};

	const transcript = (
		<MessageScrollerProvider
			autoScroll
			defaultScrollPosition="end"
			key={run}
			scrollMargin={24}
		>
			<MessageScroller className="isolate h-full min-h-0 min-w-0">
				<MessageScrollerViewport
					aria-label="Agent conversation"
					className="h-full min-h-0 min-w-0"
				>
					<MessageScrollerContent className="mx-auto w-full min-w-0 max-w-[calc(var(--breakpoint-lg)+3rem)] gap-4 pt-6 pb-16 pl-12 pr-6">
						{rows.map((row) => (
							<MessageScrollerItem
								key={row.key}
								messageId={row.key}
								scrollAnchor={
									row.kind === "message" && row.message.role === "user"
								}
							>
								{row.kind === "tools" ? (
									<ToolMessageBlock
										isRunActive={running}
										messages={row.messages}
									/>
								) : row.kind === "plan" ? (
									<TeamPlanCard
										onOpenMissionControl={() => setMissionControlOpen(true)}
										team={team}
									/>
								) : row.kind === "lanes" ? (
									<TeamLanesCard onFocusMember={focus} team={team} />
								) : (
									<MessageBubble
										agentRole={
											row.message.role === "user" ? "user" : "assistant"
										}
										isLastAssistantMessage={
											lastMessage?.kind === "message" &&
											lastMessage.message.id === row.message.id &&
											row.message.role === "assistant"
										}
										isStreaming={streamingMessageId === row.message.id}
										message={row.message}
										reasoningContent={row.reasoning ?? ""}
										reasoningRedacted={false}
										thoughtDurationMilliseconds={row.thoughtMs}
									/>
								)}
							</MessageScrollerItem>
						))}
						{status === "starting" ? (
							<MessageScrollerItem
								className="flex min-h-7 items-center gap-2 py-1 text-sm font-medium text-muted-foreground"
								messageId="activity"
							>
								<Loader2 className="size-4 animate-spin" />
								<span className={STREAMING_TITLE_CLASS}>Thinking...</span>
							</MessageScrollerItem>
						) : null}
					</MessageScrollerContent>
				</MessageScrollerViewport>
			</MessageScroller>
		</MessageScrollerProvider>
	);

	return (
		<div className="grid h-full min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
			<WindowTitleBarContent>
				<div className="cline-view-enter z-20 border-b border-border/70 bg-background/85 backdrop-blur-sm">
					<AgentHeader
						agentActivity={activity}
						agents={agents}
						onNewThread={onExit}
						onOpenAgentSession={(id) => focus(id)}
						status={status}
						title={TITLE}
					/>
				</div>
			</WindowTitleBarContent>
			<div className="flex h-full min-h-0 overflow-hidden">
				<div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
					<AgentConversationLayout
						body={transcript}
						bodyClassName="cline-view-enter"
						composer={
							<AgentComposer>
								<AgentComposerBody className="flex items-center gap-3">
									<Users className="size-4 shrink-0 text-primary" />
									<p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
										Scripted preview of an agent team.{" "}
										{teammates.some((m) => isActiveStatus(m.status))
											? `${teammates.filter((m) => isActiveStatus(m.status)).length} agents working.`
											: ""}
									</p>
									<Button
										onClick={() => setMissionControlOpen((open) => !open)}
										size="sm"
										variant="outline"
									>
										{missionControlOpen ? (
											<PanelRightClose className="size-3.5" />
										) : (
											<PanelRightOpen className="size-3.5" />
										)}
										Mission control
									</Button>
									<Button onClick={replay} size="sm" variant="outline">
										<RotateCcw className="size-3.5" />
										Replay
									</Button>
									<Button onClick={onExit} size="sm" variant="ghost">
										<X className="size-3.5" />
										Exit
									</Button>
								</AgentComposerBody>
							</AgentComposer>
						}
						welcome={false}
					/>
				</div>
				{missionControlOpen ? (
					<div className="min-h-0 w-[60%] min-w-[560px] shrink-0 animate-in fade-in-0 slide-in-from-right-4 duration-300">
						<MissionControl
							focusedMember={focusedMember}
							onClose={() => setMissionControlOpen(false)}
							onFocusMember={setFocusedMember}
							running={running}
							team={team}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}
