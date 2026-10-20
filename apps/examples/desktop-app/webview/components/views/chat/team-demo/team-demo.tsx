"use client";

import {
	AgentComposer,
	AgentComposerBody,
	AgentConversationLayout,
} from "@cline/ui";
import { RotateCcw, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AgentHeader } from "@/components/agent-header";
import { Button } from "@/components/ui/button";
import { WindowTitleBarContent } from "@/components/window-title-bar";
import type { ChatMessage, ChatSessionStatus } from "@/lib/chat-schema";
import {
	buildSessionAgentActivity,
	mergeAgentActivity,
	type SessionAgentEntry,
} from "@/lib/session-agents";
import { ChatMessages } from "../chat-messages";
import {
	buildBeats,
	FINAL_DIFF,
	LEAD,
	PROMPT,
	SCREENSHOTS,
	type SessionKey,
	TEAM_NAME,
	TEAMMATE_IDS,
	TEAMMATES,
	type TeammateId,
	TITLE,
} from "./team-script";

/*
 * Scripted preview of an agent team. The lead session and every teammate
 * session replay through the real transcript, and the header's agent roster is
 * derived from those transcripts the same way the sidecar derives it, so
 * opening a teammate behaves like opening a real child session.
 */

const sessionIdFor = (key: SessionKey) => `team-demo/${key}`;
const keyForSessionId = (sessionId: string): SessionKey | undefined =>
	[LEAD, ...TEAMMATE_IDS].find((key) => sessionIdFor(key) === sessionId);

type SessionState = {
	messages: ChatMessage[];
	status: ChatSessionStatus;
	streamingMessageId: string | null;
	startedAt?: number;
};

type DemoState = Record<SessionKey, SessionState>;

const idleSession = (): SessionState => ({
	messages: [],
	status: "idle",
	streamingMessageId: null,
});

function initialState(): DemoState {
	return {
		[LEAD]: { ...idleSession(), status: "starting" },
		"backend-dev": idleSession(),
		"ui-dev": idleSession(),
		"integration-dev": idleSession(),
		"qa-engineer": idleSession(),
	};
}

async function toBase64(src: string): Promise<string> {
	const blob = await (await fetch(src)).blob();
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function useTeamPlayback(run: number): DemoState {
	const [state, setState] = useState<DemoState>(initialState);

	useEffect(() => {
		void run;
		let cancelled = false;
		// Timestamps advance faster than playback so durations read like a real run.
		let clock = Date.now() - 12 * 60_000;
		const tick = (ms: number) => {
			clock += ms * 6;
		};
		const message = (
			key: SessionKey,
			id: string,
			role: ChatMessage["role"],
			content: string,
			extra?: Partial<ChatMessage>,
		): ChatMessage => ({
			id,
			sessionId: sessionIdFor(key),
			role,
			content,
			createdAt: clock,
			...extra,
		});
		const update = (key: SessionKey, next: Partial<SessionState>) =>
			setState((current) => ({
				...current,
				[key]: { ...current[key], ...next },
			}));
		const push = (key: SessionKey, next: ChatMessage) =>
			setState((current) => ({
				...current,
				[key]: {
					...current[key],
					messages: [...current[key].messages, next],
				},
			}));
		const replace = (key: SessionKey, next: ChatMessage) =>
			setState((current) => ({
				...current,
				[key]: {
					...current[key],
					messages: current[key].messages.map((item) =>
						item.id === next.id ? next : item,
					),
				},
			}));
		const toolMessage = (
			key: SessionKey,
			id: string,
			tool: string,
			input: unknown,
			result: unknown,
		) =>
			message(
				key,
				id,
				"tool",
				JSON.stringify({ toolName: tool, input, result: result ?? null }),
				{
					meta: {
						toolName: tool,
						toolCallId: id,
						...(result == null ? { hookEventName: "tool_call_start" } : {}),
					},
				},
			);

		void (async () => {
			const entries = await Promise.all(
				SCREENSHOTS.map(
					async (shot) => [shot.id, await toBase64(shot.src)] as const,
				),
			);
			if (cancelled) return;
			const images = Object.fromEntries(entries);
			const fresh = initialState();
			fresh[LEAD].messages = [message(LEAD, "prompt", "user", PROMPT)];
			setState(fresh);

			const open = new Map<string, { key: SessionKey; message: ChatMessage }>();
			let index = 0;
			for (const beat of buildBeats(images)) {
				await sleep(beat.wait);
				if (cancelled) return;
				tick(beat.wait);
				const key = beat.in;
				const id = `${key}-${index++}`;
				if ("status" in beat) {
					update(key, { status: beat.status });
				} else if ("start" in beat) {
					const teammate = TEAMMATES[key as TeammateId];
					push(key, message(key, id, "user", teammate.task));
					update(key, { status: "running", startedAt: clock });
				} else if ("say" in beat) {
					if (beat.thinkMs) clock += beat.thinkMs;
					const reasoning = beat.reasoning
						? { reasoning: beat.reasoning }
						: undefined;
					if (!beat.stream) {
						push(key, message(key, id, "assistant", beat.say, reasoning));
						continue;
					}
					const words = beat.say.split(/(?<=\s)/);
					push(key, message(key, id, "assistant", "", reasoning));
					update(key, { streamingMessageId: id });
					for (let count = 4; count < words.length + 4; count += 4) {
						await sleep(40);
						if (cancelled) return;
						replace(
							key,
							message(
								key,
								id,
								"assistant",
								words.slice(0, count).join(""),
								reasoning,
							),
						);
					}
					update(key, { streamingMessageId: null });
				} else if ("tool" in beat) {
					const started = toolMessage(key, id, beat.tool, beat.input, null);
					push(key, started);
					if (beat.ref) {
						open.set(beat.ref, { key, message: started });
						continue;
					}
					await sleep(beat.runMs ?? 300);
					if (cancelled) return;
					tick(beat.runMs ?? 300);
					replace(
						key,
						toolMessage(key, id, beat.tool, beat.input, beat.result),
					);
				} else {
					const pending = open.get(beat.complete);
					if (!pending) continue;
					open.delete(beat.complete);
					const payload = JSON.parse(pending.message.content) as {
						toolName: string;
						input: unknown;
					};
					replace(
						pending.key,
						toolMessage(
							pending.key,
							pending.message.id,
							payload.toolName,
							payload.input,
							beat.result,
						),
					);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [run]);

	return state;
}

/** Mirrors the sidecar's `deriveLastAction`: the latest assistant text, or the tool it ran. */
function lastActionOf(messages: ChatMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "tool" && message.meta?.toolName) {
			return `Running ${message.meta.toolName}`;
		}
		if (message?.role === "assistant") {
			const text = message.content.replace(/\s+/g, " ").trim();
			if (text) return text.length > 140 ? `${text.slice(0, 139)}…` : text;
		}
	}
	return undefined;
}

function rosterOf(state: DemoState): SessionAgentEntry[] {
	return TEAMMATE_IDS.flatMap((id) => {
		const session = state[id];
		if (!session.startedAt) return [];
		const teammate = TEAMMATES[id];
		return [
			{
				sessionId: sessionIdFor(id),
				agentId: id,
				kind: "teamtask" as const,
				status: session.status === "completed" ? "completed" : "running",
				prompt: teammate.title,
				lastAction: lastActionOf(session.messages),
				teamName: TEAM_NAME,
				startedAt: new Date(session.startedAt).toISOString(),
				hasMessages: session.messages.length > 0,
			},
		];
	});
}

const isActive = (status: ChatSessionStatus) =>
	status === "starting" || status === "running" || status === "stopping";

export function TeamDemo({ onExit }: { onExit: () => void }) {
	const [run, setRun] = useState(0);
	const [view, setView] = useState<SessionKey>(LEAD);
	const state = useTeamPlayback(run);
	const lead = state[LEAD];
	const session = state[view];
	const leadCompleted = lead.status === "completed";

	const agents = useMemo(() => rosterOf(state), [state]);
	const agentActivity = useMemo(
		() =>
			mergeAgentActivity(
				agents,
				buildSessionAgentActivity(lead.messages, {
					sessionActive: isActive(lead.status),
				}),
				{ sessionActive: isActive(lead.status) },
			),
		[agents, lead.messages, lead.status],
	);

	const openSession = (sessionId: string) => {
		const key = keyForSessionId(sessionId);
		if (key) setView(key);
	};

	return (
		<div className="grid h-full min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
			<WindowTitleBarContent>
				<div className="cline-view-enter z-20 border-b border-border/70 bg-background/85 backdrop-blur-sm">
					{view === LEAD ? (
						<AgentHeader
							agentActivity={agentActivity}
							agents={agents}
							diff={leadCompleted ? FINAL_DIFF : undefined}
							onNewThread={onExit}
							onOpenAgentSession={openSession}
							status={lead.status}
							title={TITLE}
						/>
					) : (
						<AgentHeader
							onOpenParentSession={openSession}
							parentSession={{ sessionId: sessionIdFor(LEAD), title: TITLE }}
							status={session.status}
							title={TEAMMATES[view].title}
						/>
					)}
				</div>
			</WindowTitleBarContent>
			<AgentConversationLayout
				body={
					<ChatMessages
						chatTransportState="connected"
						error={null}
						key={view}
						messages={session.messages}
						onAnswerAskQuestion={() => {}}
						onApproveToolApproval={() => {}}
						onRejectToolApproval={() => {}}
						pendingAskQuestions={[]}
						pendingToolApprovals={[]}
						sessionId={sessionIdFor(view)}
						status={session.status}
						streamingMessageId={session.streamingMessageId}
						verification={
							view === LEAD && leadCompleted
								? {
										screenshots: SCREENSHOTS,
										title: "Verified in browser",
										subtitle: "Captured by qa-engineer · Chrome 1280×800",
									}
								: undefined
						}
					/>
				}
				bodyClassName="cline-view-enter"
				composer={
					<AgentComposer>
						<AgentComposerBody className="flex items-center gap-3">
							<Users className="size-4 shrink-0 text-primary" />
							<p className="min-w-0 flex-1 text-sm text-muted-foreground">
								Scripted preview of an agent team. Open the agents menu in the
								header to look inside a teammate's session.
							</p>
							<Button
								onClick={() => {
									setView(LEAD);
									setRun((value) => value + 1);
								}}
								size="sm"
								variant="outline"
							>
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
	);
}
